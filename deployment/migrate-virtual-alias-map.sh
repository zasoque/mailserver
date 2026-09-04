#!/bin/sh
set -eu

old_source=${MAILADMIN_OLD_ALIAS_SOURCE:-/etc/postfix/virtual_alias}
new_source=${MAILADMIN_NEW_ALIAS_SOURCE:-/usr/local/var/zasoque-mailadmin/postfix/virtual_alias}
backup_root=${MAILADMIN_ALIAS_BACKUP_ROOT:-/var/backups/zasoque-mailadmin/postfix}
postmap=${MAILADMIN_POSTMAP:-/usr/sbin/postmap}
check_alias=${MAILADMIN_ALIAS_CHECK_ADDRESS:-admin@zasoque.org}
dry_run=false

if [ "${1:-}" = "--dry-run" ]; then dry_run=true; shift; fi
if [ "$#" -ne 0 ]; then echo "Usage: sudo deployment/migrate-virtual-alias-map.sh [--dry-run]" >&2; exit 1; fi
if [ "${MAILADMIN_ALLOW_NON_ROOT_TEST:-0}" != 1 ] && [ "$(id -u)" -ne 0 ]; then
	echo "Migration must be run as root." >&2; exit 1
fi
if [ ! -f "$old_source" ] || [ -L "$old_source" ]; then
	echo "Old alias source is missing or unsafe: $old_source" >&2; exit 1
fi
if [ -e "$new_source" ] && ! cmp -s "$old_source" "$new_source"; then
	echo "Destination exists with different content; refusing to overwrite: $new_source" >&2; exit 1
fi

if [ "$dry_run" = true ]; then
	echo "Would copy $old_source to $new_source, build its hash database, and verify $check_alias."
	echo "Postfix configuration and services would not be changed."
	exit 0
fi

postfix_group=$(id -gn _postfix)
new_root=$(dirname "$(dirname "$new_source")")
backup_parent=$(dirname "$backup_root")
install -d -o root -g "$postfix_group" -m 0750 "$new_root"
install -d -o root -g "$postfix_group" -m 0750 "$(dirname "$new_source")"
install -d -o root -g wheel -m 0700 "$backup_parent"
install -d -o root -g wheel -m 0700 "$backup_root"
if [ ! -e "$new_source" ]; then
	install -o root -g wheel -m 0600 "$old_source" "$new_source"
fi
chown root:wheel "$new_source"
chmod 0600 "$new_source"
"$postmap" "$new_source"
chown root:"$postfix_group" "$new_source.db"
chmod 0640 "$new_source.db"

old_result=$("$postmap" -q "$check_alias" "hash:$old_source")
new_result=$("$postmap" -q "$check_alias" "hash:$new_source")
if [ -z "$old_result" ] || [ "$old_result" != "$new_result" ]; then
	echo "Lookup verification failed for $check_alias; Postfix configuration was not changed." >&2
	exit 1
fi
cmp -s "$old_source" "$new_source"
echo "Alias map migration prepared and verified. Postfix configuration was not changed."
echo "$check_alias -> $new_result"
