# Initial VPS rebuild: MyClinicHelper + Stillkey

**One-time setup/recovery reference. The existing VPS is already configured. Use the repository's `deployment/` workflow for future Stillkey releases. Do not rerun this combined deployment on a working server; the setup script now refuses an existing installation.**

This setup is for a **freshly reinstalled Debian 13 VPS**. The bootstrap also supports Debian 12 and Ubuntu 22.04/24.04/26.04 LTS. It installs Docker Engine and the Compose plugin from Docker's official repository. Caddy runs in Docker, so there is no separate host Caddy/Nginx/PHP/MySQL installation.

The old VPS backup has already been taken and checked. Keep it off-server. The scripts do not reinstall the OS, delete the old VPS, restore old system configuration, change DNS, or connect to the VPS automatically. The bootstrap and SSH-hardening scripts must run on the VPS, not on your workstation or mounted server filesystem.

## Result

| Address | Service |
| --- | --- |
| `myclinichelper.com` | MyClinicHelper static container |
| `www.myclinichelper.com` | Same application, preserving the existing hostname |
| `stillkey.paulhiggins.cloud` | Stillkey static PWA container |

One Caddy gateway publishes TCP 80/443 and UDP 443 (HTTP/3). The gateway has outbound connectivity for certificate issuance. Each application connects to a separate internal Docker network with no published ports and no direct internet egress. Its code is baked into a versioned image, runs as an unprivileged numeric user, and has a read-only filesystem. Caddy certificate/configuration state uses persistent Docker volumes. No Docker socket is mounted into a container.

Caddy is pinned to the official `caddy:2.11.7-alpine` image. It obtains and renews HTTPS certificates; do not restore or install Certbot. Requests are not access-logged by default. Docker runtime logs rotate automatically.

## 1. Prepare the release on your workstation

The current MyClinicHelper web root is `/home/pickacab/git/mch/www`, reached on the old host through `/home/pickacab/html`. Locally it is accessible through the mounted server filesystem:

```bash
cd /home/paul/my-authenticator
bash infrastructure/initial-vps/package.sh /home/paul/myclinichelper.com/home/pickacab/git/mch/www
```

If that mount is unavailable after reinstallation, extract the application from your backup into a separate local directory and pass its `home/pickacab/git/mch/www` path instead. Do not extract the old `/etc` into the new operating system.

`package.sh` installs locked npm dependencies, runs the unit tests/typecheck/lint, builds Stillkey, and creates `infrastructure/initial-vps/out/vps-release-TIMESTAMP.tar.gz` plus its SHA-256 checksum. It packages only public application content and setup files. The old backup, credentials, repository metadata, sample QR images, and `node_modules` are not included. Absolute or escaping web-root symlinks must be fixed before packaging. The existing favicon link is broken because its PNG was moved to `img/unused`; the packager repairs that specific link in its copy only. Other broken links fail packaging.

Preserve the generated bundle locally; it is also your reproducible deployment input. Use the exact filenames printed by the script in the commands below.

## 2. Reinstall and bootstrap the VPS

In your provider console, reinstall using Debian 13 and retain your IP if supported. Keep provider console/rescue access available. Verify the new SSH host-key fingerprint through the provider console before replacing your workstation's old known-host entry.

If you have already used `ssh-copy-id root@SERVER_IP`, bootstrap can reuse `/root/.ssh/authorized_keys`. Upload just the bootstrap script; replace `SERVER_IP` with the new server IP:

```bash
# Workstation
scp infrastructure/initial-vps/bootstrap.sh root@SERVER_IP:/root/
ssh root@SERVER_IP
```

Then run on the fresh VPS, using the actual current SSH port (22 in this example):

```bash
bash /root/bootstrap.sh paul
# With a custom SSH port:
# bash /root/bootstrap.sh paul /root/.ssh/authorized_keys 2222
apt-get update
apt-get upgrade -y
```

By default bootstrap reads root's existing `authorized_keys` (using root's home directory from the account database). It never edits that source file or changes root's SSH login settings. It creates/updates the `paul` admin account and merges those keys with any keys already present for `paul`, preserving key options and removing exact duplicate lines. Missing trailing newlines are handled safely. You can still supply a different public-key file explicitly: `bash /root/bootstrap.sh paul /root/id_ed25519.pub 22`.

The bootstrap grants passwordless sudo, installs Docker/Compose, enables security updates without automatic reboots, and enables UFW for SSH and the web ports. It does not change the SSH daemon's listening port. It preserves the current SSH connection port when that information is available. It refuses to proceed if ports 80/443 are occupied or conflicting distro Docker packages exist.

Passwordless sudo is deliberate for a key-based server admin account. The user is not added to the Docker group; use `sudo docker`.

In the provider firewall, allow the actual SSH port, TCP 80/443, and optionally UDP 443. Restrict SSH to your management IP/VPN if practical. Docker-published ports can bypass UFW; do not add published ports to application containers. IPv6, if enabled, also needs firewall coverage.

## 3. Verify the new login, then harden SSH

Keep the original root session open. From a **new workstation terminal**, verify the public key works, explicitly disabling password fallback:

```bash
ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no paul@SERVER_IP
sudo -n true
```

Upload the release bundle and checksum from the workstation:

```bash
scp infrastructure/initial-vps/out/vps-release-TIMESTAMP.tar.gz infrastructure/initial-vps/out/vps-release-TIMESTAMP.tar.gz.sha256 paul@SERVER_IP:~/
```

From the new `paul` session:

```bash
cd ~
sha256sum -c vps-release-TIMESTAMP.tar.gz.sha256
mkdir -p ~/vps-release
# Use a new empty extraction directory for each later release.
tar -xzf vps-release-TIMESTAMP.tar.gz -C ~/vps-release
sudo bash ~/vps-release/setup/harden-ssh.sh paul
```

`harden-ssh.sh` requires execution through sudo from that non-root account. It validates the resulting SSH configuration before reloading, disables root login and password/interactive authentication, and retains public-key login. It restores its previous config if validation fails. Test another new `paul` key login before closing the existing sessions. Reboot if package updates require it, then reconnect as `paul`.

## 4. Set DNS and deploy

Create/update these DNS records at the authoritative DNS providers:

```text
myclinichelper.com            A      SERVER_IPV4
www.myclinichelper.com        CNAME  myclinichelper.com
stillkey.paulhiggins.cloud    A      SERVER_IPV4
```

Keep an existing working `www` A record instead if preferred. Keep other records such as MX/TXT. Set matching AAAA records only if IPv6 actually reaches this VPS; remove obsolete AAAA addresses for these hosts. If a DNS proxy/CDN is configured, use DNS-only mode initially. If CAA records restrict certificate issuance, ensure they permit Caddy's configured certificate authorities. Confirm DNS resolves publicly to the new server.

On the VPS, supply a real email address for certificate notices:

```bash
sudo bash ~/vps-release/setup/deploy.sh YOUR_EMAIL_ADDRESS
bash ~/vps-release/setup/verify.sh
```

Deployment builds the app images and validates all Caddy/Compose configuration before replacing live configuration. It creates `/srv/stacks`, checks the two app networks are internal, starts and waits for the private app health checks, then starts/reloads Caddy. Initial certificate issuance may take a little time; retry verification once DNS has propagated. Certificates require public TCP 80/443 to reach the VPS.

The first deployment needs outbound access to download OS packages and the official Caddy image. Stillkey's end users download the app shell once; their vault remains browser-local. Export an encrypted vault backup in localhost and restore it at `https://stillkey.paulhiggins.cloud` if you want to move your test accounts there.

## 5. Validate behavior

The verification script checks HTTPS on all three hostnames, app health, the PWA manifest/service worker, security/cache headers, and missing-asset 404 behavior. Then test manually:

- MyClinicHelper: form loading, GP list, body-diagram selection, PDF generation/download, and mobile layout, using synthetic patient information.
- Stillkey: create/unlock a vault, import a synthetic QR, copy a code, export/restore an encrypted backup, install the PWA, disable networking, and reopen/unlock.
- Reboot the VPS and check all three services restart.
- From another machine, confirm only intended ports are reachable. No application or database ports should be exposed.

Do not restore the old Nginx configuration over the new host. It is archived reference material, including legacy PHP/Faye/ModSecurity settings that are not needed for these two static applications. This setup does not reproduce the old ModSecurity rule engine.

## Operations and updates

Installed layout:

```text
/srv/stacks/.env
/srv/stacks/gateway/{compose.yaml,Caddyfile}
/srv/stacks/myclinichelper/compose.yaml
/srv/stacks/stillkey/compose.yaml
/srv/stacks/history/...
```

Status and logs:

```bash
sudo docker compose --env-file /srv/stacks/.env -f /srv/stacks/gateway/compose.yaml ps
sudo docker compose --env-file /srv/stacks/.env -f /srv/stacks/gateway/compose.yaml logs --tail 100
sudo docker compose --env-file /srv/stacks/.env -f /srv/stacks/stillkey/compose.yaml ps
```

Future Stillkey releases use `deployment/package.sh` and `deployment/deploy.sh` from the repository. They maintain `/srv/stacks/stillkey/.env` independently and do not modify the gateway, other applications, or the original shared `/srv/stacks/.env`. The combined initial setup script is not an update tool.

Back up `/srv/stacks` and keep the deployment bundles off-server. The `gateway_caddy_data` and `gateway_caddy_config` Docker volumes hold certificate/account state and should be included in ongoing server backups if you want to retain that state. Renewing/reissuing certificates remains possible after a clean restore. The VPS never stores Stillkey vaults: users must keep their encrypted account backups independently.

OS security updates are automatic; container images are updated deliberately. Review new Caddy releases, change its pinned version consistently in the gateway Compose file, both Dockerfiles, and `deploy.sh`, validate, then deploy a new bundle. Review Docker package updates separately; major changes/reboots may interrupt services.

## Sources and validation

- [Docker installation for Debian](https://docs.docker.com/engine/install/debian/)
- [Docker installation for Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [Caddy Docker deployment](https://caddyserver.com/docs/running#docker-compose)
- [Caddy automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https)

`test-local.py` exercises the actual images and Compose projects on isolated temporary networks and random loopback ports. Its gateway uses HTTP-only `.test` hostnames, so it never requests production certificates. It does not execute the host bootstrap or modify the VPS. Run with a working Docker daemon and Compose CLI:

```bash
python3 infrastructure/initial-vps/test-local.py --bundle infrastructure/initial-vps/out/vps-release-TIMESTAMP.tar.gz
# If Docker Compose is a standalone binary rather than a CLI plugin:
python3 infrastructure/initial-vps/test-local.py --bundle infrastructure/initial-vps/out/vps-release-TIMESTAMP.tar.gz --compose /path/to/docker-compose
```

The bootstrap's OS/SSH/firewall changes still require execution and verification on the fresh VPS. Public DNS, real certificate issuance, and provider firewall rules cannot be validated in a local container rehearsal.
