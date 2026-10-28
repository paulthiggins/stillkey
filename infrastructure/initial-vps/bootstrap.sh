#!/usr/bin/env bash
# Run on a freshly reinstalled server, not on the existing LEMP host.
set -euo pipefail
usage() { echo "Usage: sudo bash bootstrap.sh ADMIN_USER [KEY_FILE [SSH_PORT]] (KEY_FILE defaults to root authorized_keys)" >&2; exit 2; }
[[ $# -ge 1 && $# -le 3 ]] || usage
[[ $EUID -eq 0 ]] || { echo 'Run as root or with sudo.' >&2; exit 1; }
admin_user=$1
root_home=$(getent passwd root | cut -d: -f6)
key_file=${2:-"$root_home/.ssh/authorized_keys"}
ssh_port=${3:-22}
[[ $admin_user =~ ^[a-z_][a-z0-9_-]*$ && $admin_user != root ]] || usage
if [[ $key_file != /* || ! -f $key_file || ! -s $key_file ]]; then
  echo "SSH key source must be a non-empty file with an absolute path: $key_file" >&2
  echo 'Use root authorized_keys after ssh-copy-id, or supply another public-key file.' >&2
  exit 1
fi
if ! [[ $ssh_port =~ ^[0-9]+$ ]] || (( ssh_port < 1 || ssh_port > 65535 )); then usage; fi
# Public keys only; ssh-keygen validates the file before any changes.
if grep -Eq "^-----BEGIN .*PRIVATE KEY-----" "$key_file"; then
  echo "Supply a public .pub key, not a private key." >&2; exit 1
fi
ssh-keygen -l -f "$key_file" >/dev/null
# shellcheck disable=SC1091
source /etc/os-release
case "$ID:$VERSION_ID" in
  debian:12|debian:13|ubuntu:22.04|ubuntu:24.04|ubuntu:26.04) ;;
  *) echo 'Supported: Debian 12/13 or Ubuntu 22.04/24.04/26.04 LTS.' >&2; exit 1 ;;
esac
if ss -H -ltn | awk '{print $4}' | grep -Eq ':(80|443)$'; then
  echo 'Ports 80/443 are occupied. This bootstrap is for a fresh server.' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl sudo openssh-server rsync tar gzip ufw unattended-upgrades dnsutils
if ! id "$admin_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$admin_user"
fi
admin_home=$(getent passwd "$admin_user" | cut -d: -f6)
admin_group=$(id -gn "$admin_user")
[[ -d $admin_home && $admin_home != / ]] || { echo 'Invalid admin home.' >&2; exit 1; }
install -d -m 0700 -o "$admin_user" -g "$admin_group" "$admin_home/.ssh"
# Merge keys without modifying the source (including root authorized_keys).
# Retain existing admin keys and separate files even if they lack final newlines.
key_temp=$(mktemp)
trap 'rm -f "$key_temp"' EXIT
{
  if [[ -f $admin_home/.ssh/authorized_keys ]]; then
    cat "$admin_home/.ssh/authorized_keys"
    printf '\n'
  fi
  cat "$key_file"
  printf '\n'
} | awk 'NF && !seen[$0]++' > "$key_temp"
install -m 0600 -o "$admin_user" -g "$admin_group" "$key_temp" "$admin_home/.ssh/authorized_keys"
usermod -aG sudo "$admin_user"
printf '%s ALL=(ALL:ALL) NOPASSWD:ALL\n' "$admin_user" > /etc/sudoers.d/90-app-admin
chmod 0440 /etc/sudoers.d/90-app-admin
visudo -cf /etc/sudoers.d/90-app-admin

# Install Docker from its official distribution-specific apt repository.
# Refuse conflicting distro Docker packages rather than remove an existing install.
for package in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
    echo "Conflicting package $package is installed. Review it before continuing." >&2; exit 1
  fi
done
install -d -m 0755 /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
cat > /etc/apt/apt.conf.d/52-no-auto-reboot <<'APT'
Unattended-Upgrade::Automatic-Reboot "false";
APT
systemctl enable --now unattended-upgrades
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
install -d -m 0755 /srv/stacks

# Preserve the current SSH port too, if it differs from the supplied port.
ufw allow "$ssh_port/tcp"
if [[ -n ${SSH_CONNECTION:-} ]]; then
  read -r _ _ _ current_ssh_port <<< "$SSH_CONNECTION"
  if [[ $current_ssh_port =~ ^[0-9]+$ ]]; then ufw allow "$current_ssh_port/tcp"; fi
fi
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw status verbose
docker version
docker compose version
printf '\nBootstrap complete. Test SSH as %s in a NEW terminal before running harden-ssh.sh.\n' "$admin_user"
echo 'No Docker-group membership was granted. Use sudo docker.'
