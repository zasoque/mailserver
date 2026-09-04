#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then echo "stage-senderauth.sh must be run as root." >&2; exit 1; fi
if [ "$#" -ne 1 ] || [ ! -x "$1" ]; then echo "Usage: sudo deployment/stage-senderauth.sh /absolute/path/to/senderauth" >&2; exit 1; fi
case "$1" in /*) binary=$1 ;; *) echo "Binary path must be absolute." >&2; exit 1 ;; esac

target_root=/usr/local/libexec/zasoque-senderauth
install -d -o root -g wheel -m 0755 "$target_root/bin"
install -o root -g wheel -m 0755 "$binary" "$target_root/bin/senderauth"
install -d -o root -g wheel -m 0755 /var/log/zasoque-mailadmin
for log_file in senderauth.stdout.log senderauth.stderr.log; do
	if [ ! -e "/var/log/zasoque-mailadmin/$log_file" ]; then
		install -o _postfix -g _postfix -m 0600 /dev/null "/var/log/zasoque-mailadmin/$log_file"
	fi
done
echo "Staged senderauth binary. Run verify-senderauth-deployment.sh after rebuilding sender_login."
