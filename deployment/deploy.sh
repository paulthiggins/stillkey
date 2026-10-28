#!/usr/bin/env bash
# Run on the new VPS from an extracted release bundle.
set -euo pipefail
[[ $EUID -eq 0 && $# -eq 1 ]] || { echo 'Usage: sudo bash setup/deploy.sh ACME_CONTACT_EMAIL' >&2; exit 2; }
acme_email=$1
[[ $acme_email =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { echo 'Enter a valid ACME contact email.' >&2; exit 2; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bundle_dir=$(dirname "$script_dir")
stack_root=/srv/stacks
[[ -f $bundle_dir/RELEASE_ID ]] || { echo 'Run deploy.sh from an extracted release bundle.' >&2; exit 1; }
release_id=$(cat "$bundle_dir/RELEASE_ID")
[[ $release_id =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Invalid release ID.' >&2; exit 1; }
for app in myclinichelper stillkey; do
  [[ -f $bundle_dir/content/$app/public/index.html ]] || { echo "Missing $app content." >&2; exit 1; }
done
docker info >/dev/null
docker compose version
install -d -m 0755 "$stack_root"
for network in mch-proxy stillkey-proxy; do
  if docker network inspect "$network" >/dev/null 2>&1; then
    [[ $(docker network inspect --format '{{.Internal}}' "$network") == true ]] || { echo "$network exists but is not internal. Review before proceeding." >&2; exit 1; }
  else
    docker network create --internal "$network"
  fi
done
# Build and validate both images before changing the live configuration.
for app in myclinichelper stillkey; do
  docker build --pull -t "local/$app:$release_id" "$bundle_dir/content/$app"
  docker run --rm --network none --entrypoint caddy "local/$app:$release_id" validate --config /etc/caddy/Caddyfile --adapter caddyfile
done
docker pull caddy:2.11.7-alpine
docker run --rm --network none -e "ACME_EMAIL=$acme_email" \
  -v "$script_dir/gateway/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.7-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
new_env=$(mktemp)
trap 'rm -f "$new_env"' EXIT
printf 'ACME_EMAIL=%s\nRELEASE_ID=%s\n' "$acme_email" "$release_id" > "$new_env"
for app in gateway myclinichelper stillkey; do
  docker compose --env-file "$new_env" -f "$script_dir/$app/compose.yaml" config --quiet
done
if [[ -f $stack_root/.env ]]; then
  history="$stack_root/history/$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$history"
  cp -a "$stack_root/.env" "$history/.env"
  for app in gateway myclinichelper stillkey; do
    [[ ! -d $stack_root/$app ]] || cp -a "$stack_root/$app" "$history/$app"
  done
  echo "Previous configuration saved to $history; keep its old Docker images for rollback."
fi
for app in gateway myclinichelper stillkey; do
  install -d -m 0755 "$stack_root/$app"
  install -m 0644 "$script_dir/$app/compose.yaml" "$stack_root/$app/compose.yaml"
done
install -m 0644 "$script_dir/gateway/Caddyfile" "$stack_root/gateway/Caddyfile"
install -m 0600 "$new_env" "$stack_root/.env"
compose() { docker compose --env-file "$stack_root/.env" -f "$stack_root/$1/compose.yaml" "${@:2}"; }
# Validate private app readiness before starting/reloading the public gateway.
compose myclinichelper up -d --wait --wait-timeout 90
compose stillkey up -d --wait --wait-timeout 90
compose gateway up -d --wait --wait-timeout 90
compose gateway exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
for app in gateway myclinichelper stillkey; do compose "$app" ps; done
printf '\nDeployed release %s. DNS must point at this server for HTTPS issuance.\n' "$release_id"
echo 'Run verify.sh next and test both applications in a browser.'
