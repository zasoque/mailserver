#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
	echo "stage-helper.sh must be run as root." >&2
	exit 1
fi

fresh_alias_source=false
if [ "${1:-}" = "--fresh-alias-source" ]; then
	fresh_alias_source=true
	shift
fi

if [ "$#" -ne 1 ] || [ ! -x "$1" ]; then
	echo "Usage: sudo deployment/stage-helper.sh [--fresh-alias-source] /absolute/path/to/bun" >&2
	exit 1
fi

case "$1" in
	/*) bun_source=$1 ;;
	*)
		echo "The Bun executable path must be absolute." >&2
		exit 1
		;;
esac

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_root=$(dirname -- "$script_directory")
stage_root=/usr/local/libexec/zasoque-mailadmin
app_root=$stage_root/app
bun_target=$stage_root/bin/bun

test -f "$source_root/helper/server.ts"
test -d "$source_root/src/lib/mail"

install -d -o root -g wheel -m 0755 "$stage_root/bin"
install -d -o root -g wheel -m 0755 "$app_root/helper"
install -d -o root -g wheel -m 0755 "$app_root/src/lib/mail"
install -o root -g wheel -m 0755 "$bun_source" "$bun_target"

runtime_module_count=0
for module in "$source_root"/helper/*.ts; do
	case "$module" in
		*.test.ts) continue ;;
	esac
	install -o root -g wheel -m 0644 "$module" "$app_root/helper/"
	runtime_module_count=$((runtime_module_count + 1))
done

mail_type_count=0
for module in "$source_root"/src/lib/mail/*.ts; do
	install -o root -g wheel -m 0644 "$module" "$app_root/src/lib/mail/"
	mail_type_count=$((mail_type_count + 1))
done

if [ "$runtime_module_count" -eq 0 ] || [ "$mail_type_count" -eq 0 ]; then
	echo "No helper runtime modules or shared mail modules were staged." >&2
	exit 1
fi

install -d -o root -g wheel -m 0755 /var/log/zasoque-mailadmin
install -d -o root -g wheel -m 0700 /var/backups/zasoque-mailadmin
install -d -o root -g wheel -m 0700 /var/backups/zasoque-mailadmin/postfix

postfix_group=$(id -gn _postfix)
install -d -o root -g "$postfix_group" -m 0750 /usr/local/var/zasoque-mailadmin
install -d -o root -g "$postfix_group" -m 0750 /usr/local/var/zasoque-mailadmin/postfix
alias_source=/usr/local/var/zasoque-mailadmin/postfix/virtual_alias
if [ "$fresh_alias_source" = true ] && [ ! -e "$alias_source" ]; then
	install -o root -g wheel -m 0600 /dev/null "$alias_source"
	echo "Created fresh empty alias source: $alias_source"
elif [ -e "$alias_source" ]; then
	echo "Preserved existing alias source: $alias_source"
else
	echo "Alias source not created; run migrate-virtual-alias-map.sh before starting the helper."
fi

MAILADMIN_HELPER_STAGE_ROOT=$stage_root \
	MAILADMIN_HELPER_BUN=$bun_target \
	"$script_directory/verify-helper-deployment.sh"

echo "Staged $runtime_module_count helper modules and $mail_type_count shared mail modules."
