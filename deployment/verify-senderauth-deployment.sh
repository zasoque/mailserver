#!/bin/sh
set -eu

binary=${MAILADMIN_SENDERAUTH_BINARY:-/usr/local/libexec/zasoque-senderauth/bin/senderauth}
test -x "$binary"
file "$binary"
if [ "$(id -u)" -eq 0 ]; then
	sudo -u _postfix "$binary" --check-config
else
	echo "Run this verifier with sudo to test sender_login access as _postfix." >&2
	exit 1
fi
echo "Sender authorization deployment verification passed."
