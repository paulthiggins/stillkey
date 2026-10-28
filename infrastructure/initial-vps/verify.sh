#!/usr/bin/env bash
# Run from any machine with curl after public DNS/HTTPS is ready.
set -euo pipefail
for host in myclinichelper.com www.myclinichelper.com stillkey.paulhiggins.cloud; do
  echo "Checking https://$host/"
  curl --fail --silent --show-error --retry 4 --retry-delay 5 --retry-all-errors --max-time 30 "https://$host/" -o /dev/null
  curl --fail --silent --show-error --max-time 30 "https://$host/healthz" | grep -qx ok
done
headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
curl --fail --silent --show-error --max-time 30 -D "$headers" https://stillkey.paulhiggins.cloud/sw.js -o /dev/null
grep -Eiq '^cache-control:.*no-cache' "$headers"
grep -Eiq '^content-security-policy:.*frame-ancestors' "$headers"
curl --fail --silent --show-error --max-time 30 https://stillkey.paulhiggins.cloud/manifest.webmanifest -o /dev/null
status=$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' https://stillkey.paulhiggins.cloud/assets/missing-file.js)
[[ $status == 404 ]] || { echo "Missing assets must return 404, got $status" >&2; exit 1; }
echo 'HTTP checks passed. Also test clinic form/PDF generation and Stillkey installation/offline use.'
