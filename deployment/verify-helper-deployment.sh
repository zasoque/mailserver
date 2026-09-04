#!/bin/sh
set -eu

stage_root=${MAILADMIN_HELPER_STAGE_ROOT:-/usr/local/libexec/zasoque-mailadmin}
bun_executable=${MAILADMIN_HELPER_BUN:-$stage_root/bin/bun}
entrypoint=$stage_root/app/helper/server.ts

if [ ! -x "$bun_executable" ]; then
	echo "Staged Bun executable is missing or not executable: $bun_executable" >&2
	exit 1
fi
if [ ! -f "$entrypoint" ]; then
	echo "Helper entrypoint is missing: $entrypoint" >&2
	exit 1
fi

verification_directory=$(mktemp -d /tmp/zasoque-mailadmin-helper-verify.XXXXXX)
trap 'rm -rf "$verification_directory"' EXIT HUP INT TERM

# Bun resolves the complete static import graph without executing server.ts.
# A missing runtime helper or shared mail module makes this command fail.
"$bun_executable" build "$entrypoint" \
	--target=bun \
	--outdir "$verification_directory" \
	>/dev/null

if [ ! -f "$verification_directory/server.js" ]; then
	echo "Helper dependency verification did not produce the expected bundle." >&2
	exit 1
fi

echo "Helper import dependency verification passed: $entrypoint"

