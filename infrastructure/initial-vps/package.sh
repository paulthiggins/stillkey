#!/usr/bin/env bash
# Run locally: package only public web content and deployment configuration.
set -euo pipefail
[[ $# -ge 1 && $# -le 2 ]] || { echo 'Usage: bash deployment/package.sh /path/to/myclinichelper/www [output-directory]' >&2; exit 2; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd "$script_dir/../.." && pwd)
site_source=$(realpath "$1")
output_dir=${2:-"$script_dir/out"}
[[ -f $site_source/index.html ]] || { echo 'MyClinicHelper index.html not found.' >&2; exit 1; }
for tool in npm python3 rsync tar; do command -v "$tool" >/dev/null || { echo "Required tool: $tool" >&2; exit 1; }; done
# Reject escaping/broken symlinks so a public image cannot expose outside files.
python3 - "$site_source" <<'PY'
import pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve()
for path in root.rglob('*'):
    if path.is_symlink():
        if path.readlink().is_absolute():
            raise SystemExit(f'Public web root has an absolute symlink: {path.relative_to(root)}')
        if (path.relative_to(root).as_posix() == 'favicon.ico'
            and path.readlink().as_posix() == 'img/male_32x32_toned.png'
            and not path.exists()
            and (root/'img/unused/male_32x32_toned.png').is_file()):
            print('Repairing the known broken favicon link in the packaged copy only.')
            continue
        target=path.resolve(strict=True)
        if not target.is_relative_to(root):
            raise SystemExit(f'Public web root has an escaping symlink: {path.relative_to(root)}')
PY
(cd "$repo_dir" && npm ci && npm run typecheck && npm run lint && npm test && npm run build)
mkdir -p "$output_dir"
output_dir=$(realpath "$output_dir")
release_id=$(date -u +%Y%m%dT%H%M%SZ)
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
mkdir -p "$staging/content/myclinichelper/public" "$staging/content/stillkey/public" "$staging/setup"
# Never package repository metadata, credentials, or source backups as web content.
rsync -rlt --safe-links --exclude='.git' --exclude='.env' --exclude='.env.*' --exclude='*.sql' --exclude='*.bak' "$site_source/" "$staging/content/myclinichelper/public/"
if [[ -L $staging/content/myclinichelper/public/favicon.ico && ! -e $staging/content/myclinichelper/public/favicon.ico && -f $staging/content/myclinichelper/public/img/unused/male_32x32_toned.png ]]; then
  ln -sfn img/unused/male_32x32_toned.png "$staging/content/myclinichelper/public/favicon.ico"
fi
rsync -rlt "$repo_dir/dist/" "$staging/content/stillkey/public/"
rsync -rlt --exclude='out/' --exclude='__pycache__/' "$script_dir/" "$staging/setup/"
for app in myclinichelper stillkey; do
  cp "$script_dir/$app/Caddyfile" "$script_dir/$app/Dockerfile" "$staging/content/$app/"
done
# Normalize the copied content only; do not change permissions on source/mounted files.
find "$staging/content" -type d -exec chmod 0755 {} +
find "$staging/content" -type f -exec chmod 0644 {} +
printf '%s\n' "$release_id" > "$staging/RELEASE_ID"
archive="$output_dir/vps-release-$release_id.tar.gz"
tar -czf "$archive" -C "$staging" RELEASE_ID setup content
(cd "$output_dir" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
printf '\nRelease created:\n%s\n%s\n' "$archive" "$archive.sha256"
