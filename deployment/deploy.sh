#!/usr/bin/env bash
# Update only Stillkey on an already configured VPS. No gateway or other-app writes.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deployment/common.sh
source "$script_dir/common.sh"
configure "$@"
lock_app
bundle_dir=$(dirname "$script_dir")
[[ -f $bundle_dir/APPLICATION && $(cat "$bundle_dir/APPLICATION") == stillkey ]] || { echo 'Use a Stillkey-only release bundle.' >&2; exit 1; }
release_id=$(cat "$bundle_dir/RELEASE_ID")
[[ $release_id =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Invalid release ID.' >&2; exit 1; }
[[ -f $bundle_dir/content/stillkey/public/index.html ]] || { echo 'Missing Stillkey content.' >&2; exit 1; }
current_env="$app_dir/.env"
# One-time compatibility with the original combined installation: read, never edit.
[[ -f $current_env ]] || current_env="$stack_root/.env"
[[ -f $current_env ]] || { echo 'Existing deployment environment not found.' >&2; exit 1; }
current_container=$(compose --env-file "$current_env" -f "$app_dir/compose.yaml" ps --all --quiet web)
[[ -n $current_container && $current_container != *$'\n'* ]] || { echo 'Expected exactly one existing Stillkey web container.' >&2; exit 1; }
current_image=$(docker inspect --format '{{.Image}}' "$current_container")
current_config=$(mktemp)
new_env=$(mktemp)
trap 'rm -f "$current_config" "$new_env"' EXIT
compose --env-file "$current_env" -f "$app_dir/compose.yaml" config --format json > "$current_config"
network=$(python3 - "$current_config" <<'PY'
import json,sys
c=json.load(open(sys.argv[1]))
if set(c['services']) != {'web'} or set(c['services']['web']['networks']) != {'proxy'}:
    raise SystemExit('Expected the existing single-service Stillkey configuration.')
print(c['networks']['proxy']['name'])
PY
)
[[ $(docker network inspect --format '{{.Internal}}' "$network") == true ]] || { echo 'Stillkey proxy network must already exist and be internal.' >&2; exit 1; }
[[ $network =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid proxy network name.' >&2; exit 1; }
printf 'RELEASE_ID=%s\nSTILLKEY_PROXY_NETWORK=%s\n' "$release_id" "$network" > "$new_env"
compose --env-file "$new_env" -f "$script_dir/stillkey/compose.yaml" config --quiet

# Retain the exact previous image even if a release tag is subsequently rebuilt.
install -d -m 0700 "$app_dir/history"
snapshot=$(mktemp -d "$app_dir/history/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
rollback_image="local/stillkey:rollback-$(basename "$snapshot")"
docker image tag "$current_image" "$rollback_image"
python3 - "$current_config" "$snapshot/previous.compose.json" "$rollback_image" <<'PY'
import json,sys
c=json.load(open(sys.argv[1]));c['services']['web']['image']=sys.argv[3]
c['services']['web']['pull_policy']='never'
with open(sys.argv[2],'w') as f: json.dump(c,f,indent=2)
PY
printf 'RELEASE_ID=%s\nSTILLKEY_PROXY_NETWORK=%s\n' "rollback-$(basename "$snapshot")" "$network" > "$snapshot/previous.env"
chmod 0600 "$snapshot/previous.compose.json" "$snapshot/previous.env"

docker build --pull -t "local/stillkey:$release_id" "$bundle_dir/content/stillkey"
docker run --rm --network none --entrypoint caddy "local/stillkey:$release_id" validate --config /etc/caddy/Caddyfile --adapter caddyfile
install -m 0644 "$script_dir/stillkey/compose.yaml" "$app_dir/compose.yaml"
install -m 0600 "$new_env" "$app_dir/.env"
if ! compose --env-file "$app_dir/.env" -f "$app_dir/compose.yaml" up -d --wait --wait-timeout 90; then
  echo 'Stillkey update failed. Restoring the previous app image/configuration.' >&2
  if ! restore_snapshot "$snapshot"; then
    echo "Automatic rollback also failed. Inspect Docker logs; recovery snapshot: $snapshot" >&2
  fi
  exit 1
fi
printf '\nStillkey release %s deployed. Rollback snapshot: %s\n' "$release_id" "$snapshot"
echo 'Existing shared configuration, routes, certificates, and other apps were not modified.'
