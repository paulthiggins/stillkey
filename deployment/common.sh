#!/usr/bin/env bash
# Shared by the app-only deploy and rollback commands. No changes on sourcing.
configure() {
  stack_root=/srv/stacks
  if [[ $# -gt 0 ]]; then
    [[ $# -eq 2 && $1 == --stack-root && $2 == /* ]] || { echo 'Optional arguments: --stack-root /absolute/path' >&2; return 2; }
    stack_root=$2
  fi
  stack_root=$(realpath -e "$stack_root")
  app_dir="$stack_root/stillkey"
  [[ -f $app_dir/compose.yaml && -w $app_dir ]] || { echo 'Existing Stillkey installation not found or not writable. Run with sudo on the configured VPS.' >&2; return 1; }
  project=${STILLKEY_PROJECT_NAME:-stillkey}
  [[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project name.' >&2; return 1; }
  if [[ -n ${STILLKEY_COMPOSE_BIN:-} ]]; then
    compose_command=("$STILLKEY_COMPOSE_BIN")
  else
    compose_command=(docker compose)
  fi
  docker info >/dev/null
  "${compose_command[@]}" version
}
lock_app() {
  exec 9>"$app_dir/.deploy.lock"
  flock -n 9 || { echo 'Another Stillkey deployment/rollback is running.' >&2; return 1; }
}
compose() { "${compose_command[@]}" -p "$project" "$@"; }
restore_snapshot() {
  local snapshot=$1
  [[ -f $snapshot/previous.compose.json && -f $snapshot/previous.env ]] || { echo 'Incomplete Stillkey snapshot.' >&2; return 1; }
  # Use a saved, fully resolved app-only configuration and a retained image tag.
  compose -f "$snapshot/previous.compose.json" up -d --wait --wait-timeout 90 || return 1
  install -m 0644 "$snapshot/previous.compose.json" "$app_dir/compose.yaml" || return 1
  install -m 0600 "$snapshot/previous.env" "$app_dir/.env" || return 1
}
