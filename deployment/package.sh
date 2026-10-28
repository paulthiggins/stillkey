#!/usr/bin/env bash
# Build a Stillkey-only release. Shared VPS infrastructure is deliberately excluded.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(dirname "$script_dir")
output_dir="$script_dir/out"
if [[ $# -gt 0 ]]; then
  [[ $# -eq 2 && $1 == --output ]] || { echo 'Usage: bash deployment/package.sh [--output DIRECTORY] (no other app source is required)' >&2; exit 2; }
  output_dir=$2
fi
for tool in npm rsync tar; do command -v "$tool" >/dev/null || { echo "Required tool: $tool" >&2; exit 1; }; done
(cd "$repo_dir" && npm ci && npm run typecheck && npm run lint && npm test && npm run build)
mkdir -p "$output_dir"
output_dir=$(realpath "$output_dir")
release_id=$(date -u +%Y%m%dT%H%M%SZ)
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
mkdir -p "$staging/content/stillkey/public" "$staging/setup/stillkey"
rsync -rlt "$repo_dir/dist/" "$staging/content/stillkey/public/"
cp "$script_dir/stillkey/Caddyfile" "$script_dir/stillkey/Dockerfile" "$staging/content/stillkey/"
cp "$script_dir/stillkey/compose.yaml" "$staging/setup/stillkey/"
cp "$script_dir/README.md" "$script_dir/deploy.sh" "$script_dir/common.sh" "$script_dir/rollback.sh" "$script_dir/verify.sh" "$staging/setup/"
find "$staging" -type d -exec chmod 0755 {} +
find "$staging" -type f -exec chmod 0644 {} +
printf 'stillkey\n' > "$staging/APPLICATION"
printf '%s\n' "$release_id" > "$staging/RELEASE_ID"
archive="$output_dir/stillkey-release-$release_id.tar.gz"
tar -czf "$archive" -C "$staging" APPLICATION RELEASE_ID setup content
(cd "$output_dir" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
printf '\nStillkey release created:\n%s\n%s\n' "$archive" "$archive.sha256"
