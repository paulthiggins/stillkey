#!/usr/bin/env bash
# Run with sudo from the new admin login AFTER proving key login works.
set -euo pipefail
[[ $EUID -eq 0 && $# -eq 1 ]] || { echo 'Usage: sudo bash harden-ssh.sh ADMIN_USER' >&2; exit 2; }
admin_user=$1
[[ $admin_user != root && ${SUDO_USER:-} == "$admin_user" ]] || { echo 'Run using sudo from the tested non-root admin login.' >&2; exit 1; }
[[ -s $(getent passwd "$admin_user" | cut -d: -f6)/.ssh/authorized_keys ]] || { echo 'Admin authorized_keys missing.' >&2; exit 1; }
config=/etc/ssh/sshd_config.d/00-app-hardening.conf
mkdir -p /etc/ssh/sshd_config.d
backup=$(mktemp)
had_previous=false
if [[ -f $config ]]; then cp -a "$config" "$backup"; had_previous=true; fi
restore() { if $had_previous; then cp -a "$backup" "$config"; else rm -f "$config"; fi; rm -f "$backup"; }
trap restore ERR
cat > "$config" <<'SSH'
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
SSH
chmod 0644 "$config"
/usr/sbin/sshd -t
settings=$(/usr/sbin/sshd -T)
for required in 'pubkeyauthentication yes' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin no'; do
  grep -Fxq "$required" <<< "$settings" || { echo "An existing SSH setting overrides: $required" >&2; false; }
done
systemctl reload ssh
trap - ERR
rm -f "$backup"
echo 'SSH hardened. Keep this session open and verify another new key-based login.'
