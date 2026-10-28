#!/usr/bin/env bash
# Roll back only Stillkey to a snapshot made by the app-only deployment script.
set -euo pipefail
[[ $# -ge 1 ]] || { echo 'Usage: sudo bash setup/rollback.sh SNAPSHOT [--stack-root /path]' >&2; exit 2; }
snapshot=$(realpath -e "$1")
shift
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=deployment/common.sh
source "$script_dir/common.sh"
configure "$@"
[[ $snapshot == "$app_dir/history/"* && -d $snapshot ]] || { echo 'Snapshot must be inside this Stillkey installation history directory.' >&2; exit 1; }
lock_app
restore_snapshot "$snapshot"
echo 'Previous Stillkey image/configuration restored. Other services were not modified.'
