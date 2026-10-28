#!/usr/bin/env bash
# Read-only public checks for Stillkey; no requests to other applications.
set -euo pipefail
[[ $# -le 1 ]] || { echo 'Usage: bash setup/verify.sh [https://stillkey.paulhiggins.cloud]' >&2; exit 2; }
base_url=${1:-https://stillkey.paulhiggins.cloud}
base_url=${base_url%/}
[[ $base_url == https://* ]] || { echo 'Use an HTTPS URL.' >&2; exit 2; }
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
curl --fail --silent --show-error --retry 4 --retry-delay 5 --retry-all-errors --max-time 30 "$base_url/" -o /dev/null
curl --fail --silent --show-error --max-time 30 "$base_url/healthz" | grep -qx ok
curl --fail --silent --show-error --max-time 30 -D "$headers" "$base_url/sw.js" -o /dev/null
grep -Eiq '^cache-control:.*no-cache' "$headers"
grep -Eiq '^content-security-policy:.*frame-ancestors' "$headers"
curl --fail --silent --show-error --max-time 30 "$base_url/manifest.webmanifest" -o /dev/null
status=$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "$base_url/assets/missing-file.js")
[[ $status == 404 ]] || { echo "Missing assets must return 404, got $status" >&2; exit 1; }
echo 'Stillkey HTTP checks passed. Also test installation, vault unlock, and offline use.'
