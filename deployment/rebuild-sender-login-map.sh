#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
	echo "rebuild-sender-login-map.sh must be run as root." >&2
	exit 1
fi

stage_root=${MAILADMIN_HELPER_STAGE_ROOT:-/usr/local/libexec/zasoque-mailadmin}
bun_executable=$stage_root/bin/bun
entrypoint=$stage_root/app/helper/rebuild-sender-login.ts

test -x "$bun_executable"
test -f "$entrypoint"
exec "$bun_executable" "$entrypoint"
