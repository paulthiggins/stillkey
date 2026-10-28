# Stillkey-only releases

Use this directory for normal Stillkey updates to the already configured VPS. A release contains Stillkey's built files, its app container configuration, and its deploy/rollback/verification scripts. It does not contain another application's source, the shared gateway, host bootstrap, or SSH setup.

The working server needs no immediate migration. Its existing routing and containers remain as they are until you choose to deploy a new Stillkey release. The first app-only update recognizes the original installation automatically.

## Package locally

```bash
cd /home/paul/my-authenticator
bash deployment/package.sh
```

This runs locked dependency installation, type checking, lint, unit tests, and the production build. It creates `deployment/out/stillkey-release-TIMESTAMP.tar.gz` and a matching `.sha256` file. An optional `--output DIRECTORY` changes the output location. The old application-source argument is no longer accepted.

The package contains no credentials, private QR samples, source repository, `node_modules`, or infrastructure configuration. You no longer need the old site's filesystem mounted to make a Stillkey release.

## Upload and update Stillkey

Use the actual filenames printed by the packager:

```bash
# Workstation
scp deployment/out/stillkey-release-TIMESTAMP.tar.gz deployment/out/stillkey-release-TIMESTAMP.tar.gz.sha256 paul@SERVER_IP:~/
```

On the VPS:

```bash
cd ~
sha256sum -c stillkey-release-TIMESTAMP.tar.gz.sha256
mkdir ~/stillkey-release-TIMESTAMP
tar -xzf stillkey-release-TIMESTAMP.tar.gz -C ~/stillkey-release-TIMESTAMP
sudo bash ~/stillkey-release-TIMESTAMP/setup/deploy.sh
bash ~/stillkey-release-TIMESTAMP/setup/verify.sh
```

No certificate email is needed for an app update. The shared gateway already owns HTTPS and routing. Its route continues to reach `stillkey-web:8080` on the existing proxy network when the app container is replaced.

The updater:

1. Locks only the Stillkey deployment and checks the existing app/network.
2. Saves a resolved rollback configuration and retains the exact previous image under a rollback tag.
3. Builds and validates the new Stillkey image.
4. Writes only `/srv/stacks/stillkey/compose.yaml`, `/srv/stacks/stillkey/.env`, and Stillkey history.
5. Updates only the `stillkey` Compose project and waits for its health check. If startup fails, it attempts to restore the previous app image/configuration automatically and reports the failure.

It does not write `/srv/stacks/.env`, modify certificates/routes/firewall/SSH, reload the gateway, or deploy other apps. A brief interruption of Stillkey's web server is possible during container replacement; installed offline clients can continue using their cached app. Browser vaults remain local and the service worker offers an update.

## Compatibility with the original server setup

The original deployment used a shared `/srv/stacks/.env` containing a release ID for both apps. On the first independent update, the script reads that file to locate the current Stillkey container, then creates an app-specific `/srv/stacks/stillkey/.env`. The shared file stays unchanged for other services.

Use the app-specific environment for later Stillkey administration:

```bash
sudo docker compose --env-file /srv/stacks/stillkey/.env -f /srv/stacks/stillkey/compose.yaml ps
sudo docker compose --env-file /srv/stacks/stillkey/.env -f /srv/stacks/stillkey/compose.yaml logs --tail 100
```

Do not use the old shared `--env-file /srv/stacks/.env` for Stillkey updates after this transition. Do not run an old `vps-release-*` bundle for routine updates; those are combined initial-server packages. They have been moved locally under `infrastructure/initial-vps/out/` to distinguish them from app releases.

## Rollback

The updater prints a snapshot path under `/srv/stacks/stillkey/history/`. To restore one:

```bash
sudo bash ~/stillkey-release-TIMESTAMP/setup/rollback.sh /srv/stacks/stillkey/history/SNAPSHOT
```

Rollback operates on Stillkey alone. It uses a fully resolved saved Compose configuration, so it also works for the first update from the old shared environment. It restores that configuration as valid JSON-in-YAML and an app-local environment file. Keep the retained `local/stillkey:rollback-*` images until you no longer need those snapshots; image pruning can remove rollback capability. The next normal release replaces the resolved configuration with the current template again.

For a controlled local rehearsal, the deploy/rollback scripts accept `--stack-root /absolute/path`; the default is `/srv/stacks`. The test harness supplies isolated project names through `STILLKEY_PROJECT_NAME` and an optional standalone Compose CLI through `STILLKEY_COMPOSE_BIN`. Production commands above need neither variable.

## Verification

`verify.sh` performs read-only checks against `https://stillkey.paulhiggins.cloud`, or an optional HTTPS base URL. It checks the app, health, manifest, service worker, cache/security headers, and missing-asset handling. Also test unlock, synthetic QR import, backups, installation, and offline reopening after a deployment.

The local Docker rehearsal starts a representative existing installation, runs the actual app-only updater twice and a rollback, and verifies the shared configuration and unrelated container identities do not change:

```bash
python3 deployment/test-local.py --bundle deployment/out/stillkey-release-TIMESTAMP.tar.gz
# If using a standalone Compose CLI locally:
python3 deployment/test-local.py --bundle deployment/out/stillkey-release-TIMESTAMP.tar.gz --compose /path/to/docker-compose
```

## Initial server setup

Server-wide bootstrap, SSH hardening, shared Caddy routes, and the original site migration are kept separately under `infrastructure/initial-vps/` as initial setup/recovery reference. That combined deploy script now refuses an already configured server. The infrastructure directory can later move to its own repository; it is never copied into a Stillkey release.
