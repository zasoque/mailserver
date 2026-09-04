# Production deployment on macOS

The web application and privileged helper listen on IPv4 loopback only:

- Web: `127.0.0.1:8788` (configurable with `HOST`/`PORT`, but the launcher rejects non-loopback `HOST`)
- Helper: `127.0.0.1:8787` (configurable with `MAIL_HELPER_PORT`)

The web service is a system LaunchDaemon with `UserName=jeonhangyeol`, rather than a LaunchAgent.
This starts at boot before login while keeping the web process unprivileged. The helper is a separate
root LaunchDaemon.

## 1. Build and verify

From `/Users/jeonhangyeol/Programming/mailserver`:

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run build
```

`bun run start` launches only the adapter-node output in `build/`, with defaults `HOST=127.0.0.1`
and `PORT=8788`. It requires the authentication settings described below.

## Administrator authentication secrets

Generate a bcrypt hash without putting the plaintext password in an argument. The command prompts
twice with terminal echo disabled and prints only the resulting cost-12 bcrypt hash to stdout:

```sh
bun run hash-admin-password
```

```text
Password:
Confirm password:
$2b$12$...
```

Generate an independent session secret:

```sh
openssl rand -base64 48
```

Create the service-user-owned config outside the repository using `deployment/web.env.example` as
the template. Paste only the generated hash and secret, never the plaintext password:

```sh
install -d -m 0700 /Users/jeonhangyeol/.config/zasoque-mailadmin
install -m 0600 deployment/web.env.example /Users/jeonhangyeol/.config/zasoque-mailadmin/web.env
chmod 0600 /Users/jeonhangyeol/.config/zasoque-mailadmin/web.env
```

Edit `/Users/jeonhangyeol/.config/zasoque-mailadmin/web.env`, then verify it is owned by
`jeonhangyeol` and has mode `0600`. The launcher refuses group/world-readable files. The plist
contains only the config path; it contains no username, password hash, or session secret.

For a foreground production check using the same config:

```sh
MAIL_ADMIN_CONFIG_FILE=/Users/jeonhangyeol/.config/zasoque-mailadmin/web.env \
ORIGIN=http://127.0.0.1:8788 \
bun run start
```

The current executable paths used to create the plist files were:

```text
/Users/jeonhangyeol/.bun/bin/bun
/Users/jeonhangyeol/.nvm/versions/node/v22.22.0/bin/node
```

Re-run `command -v bun` and `command -v node` before installation. If Node moved, update the web
plist. The helper copies the discovered Bun executable into a root-owned location so a normal user
cannot replace an executable that a root daemon runs.

## 2. Stage the root helper

Do not run root directly from a user-writable project or from the user-owned Bun executable. Stage
the small helper runtime as root:

```sh
sudo install -d -o root -g wheel -m 0755 /usr/local/libexec/zasoque-mailadmin/bin
sudo install -d -o root -g wheel -m 0755 /usr/local/libexec/zasoque-mailadmin/app/helper
sudo install -d -o root -g wheel -m 0755 /usr/local/libexec/zasoque-mailadmin/app/src/lib/mail
sudo install -o root -g wheel -m 0755 /Users/jeonhangyeol/.bun/bin/bun /usr/local/libexec/zasoque-mailadmin/bin/bun
sudo install -o root -g wheel -m 0644 helper/server.ts helper/account-creator.ts helper/account-reader.ts helper/alias-service.ts helper/deleted-account-service.ts helper/status-service.ts helper/trash-service.ts helper/operation-queue.ts /usr/local/libexec/zasoque-mailadmin/app/helper/
sudo install -o root -g wheel -m 0644 src/lib/mail/accounts.ts src/lib/mail/aliases.ts src/lib/mail/deleted.ts src/lib/mail/status.ts src/lib/mail/trash.ts src/lib/mail/config.ts /usr/local/libexec/zasoque-mailadmin/app/src/lib/mail/
sudo install -d -o root -g wheel -m 0755 /var/log/zasoque-mailadmin
```

Repeat the staging commands after helper code or Bun is upgraded, then restart the helper.

## 3. Prepare web logs and install plists

```sh
install -d -m 0755 /Users/jeonhangyeol/Library/Logs/ZasoqueMailAdmin
touch /Users/jeonhangyeol/Library/Logs/ZasoqueMailAdmin/web.stdout.log
touch /Users/jeonhangyeol/Library/Logs/ZasoqueMailAdmin/web.stderr.log
plutil -lint deployment/launchd/org.zasoque.mailadmin.helper.plist
plutil -lint deployment/launchd/org.zasoque.mailadmin.web.plist
sudo install -o root -g wheel -m 0644 deployment/launchd/org.zasoque.mailadmin.helper.plist /Library/LaunchDaemons/org.zasoque.mailadmin.helper.plist
sudo install -o root -g wheel -m 0644 deployment/launchd/org.zasoque.mailadmin.web.plist /Library/LaunchDaemons/org.zasoque.mailadmin.web.plist
```

## 4. Start, stop, and restart

First installation/start:

```sh
sudo launchctl bootstrap system /Library/LaunchDaemons/org.zasoque.mailadmin.helper.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/org.zasoque.mailadmin.web.plist
```

Restart running services:

```sh
sudo launchctl kickstart -k system/org.zasoque.mailadmin.helper
sudo launchctl kickstart -k system/org.zasoque.mailadmin.web
```

Stop and unload services (required because `KeepAlive` would otherwise restart them):

```sh
sudo launchctl bootout system/org.zasoque.mailadmin.web
sudo launchctl bootout system/org.zasoque.mailadmin.helper
```

After changing a plist, boot it out, reinstall it, and bootstrap it again.

## 5. Logs and health checks

```sh
tail -f /var/log/zasoque-mailadmin/helper.stdout.log
tail -f /var/log/zasoque-mailadmin/helper.stderr.log
tail -f /Users/jeonhangyeol/Library/Logs/ZasoqueMailAdmin/web.stdout.log
tail -f /Users/jeonhangyeol/Library/Logs/ZasoqueMailAdmin/web.stderr.log
sudo launchctl print system/org.zasoque.mailadmin.helper
sudo launchctl print system/org.zasoque.mailadmin.web
curl --fail --silent --show-error http://127.0.0.1:8788/api/accounts
lsof -nP -iTCP:8787 -sTCP:LISTEN
lsof -nP -iTCP:8788 -sTCP:LISTEN
```

Both listeners must show `127.0.0.1`, never `*`, `0.0.0.0`, or a LAN address. After a reboot,
repeat the `launchctl print`, `curl`, and `lsof` checks before relying on the service.

To access the UI remotely, place an authenticated reverse proxy or SSH tunnel in front of the web
loopback port. Do not change `HOST` to expose the Node server. The production plist sets
`ORIGIN=https://admin.mail.zasoque.org` for Caddy while leaving `HOST=127.0.0.1`; this is also the
only accepted browser Origin for state-changing API requests.

After login, the server issues an eight-hour `HttpOnly; Secure; SameSite=Lax; Path=/` cookie. Session
records are held only in web-process memory and contain the administrator username and expiry, not
the password or hash. Restarting the web service invalidates all sessions.

## 6. Lock down the Dovecot users file

The web process no longer reads this file; only Dovecot and the root helper need access. Preserve
the verified production owner and mode:

```sh
sudo chown root:mail /opt/homebrew/etc/dovecot/users
sudo chmod 0640 /opt/homebrew/etc/dovecot/users
sudo doveadm auth test jeonhangyeol@zasoque.org
```

Never change it to a world-readable mode.

## 7. Deploy authentication updates

Authentication changes affect only the web build and web service. They do not require Dovecot,
Postfix, or helper configuration changes:

```sh
cd /Users/jeonhangyeol/Programming/mailserver
bun install --frozen-lockfile
bun run check
bun test
bun run build
plutil -lint deployment/launchd/org.zasoque.mailadmin.web.plist
sudo launchctl bootout system/org.zasoque.mailadmin.web
sudo install -o root -g wheel -m 0644 deployment/launchd/org.zasoque.mailadmin.web.plist /Library/LaunchDaemons/org.zasoque.mailadmin.web.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/org.zasoque.mailadmin.web.plist
```

The files that must be present for the updated web service are the new `build/` output,
`deployment/start-web.mjs`, installed runtime dependencies (including `bcryptjs`), and the external
`web.env` secret config. Restarting the service intentionally invalidates existing in-memory admin
sessions.

## 8. Postfix virtual aliases

The helper manages the existing Postfix hash map without changing the mail routing design:

```text
virtual_alias_maps = hash:/etc/postfix/virtual_alias
source: /etc/postfix/virtual_alias
lookup database: /etc/postfix/virtual_alias.db
postmap: /usr/sbin/postmap
```

Alias reads and mutations flow through Browser → authenticated SvelteKit → loopback helper. The web
process never reads `/etc/postfix/virtual_alias`. Alias creation, destination updates, and deletion
atomically replace the source while preserving its owner/mode, then execute `/usr/sbin/postmap` with
`shell:false` and the fixed source path as its only argument. No Postfix reload is issued: hash map
lookups observe the database generated by `postmap` without a configuration reload.

Before each mutation the source is backed up. If `postmap` fails, the helper restores the old source
with another atomic write and runs `postmap` again to rebuild the old database. Account and alias
mutations share one in-process queue. An account used as an alias destination cannot be deleted, and
an account cannot be created over an existing alias address.

The source only needs to be readable by root; the generated database must remain readable by the
Postfix lookup process. A typical local configuration is:

```sh
sudo chown root:wheel /etc/postfix/virtual_alias
sudo chmod 0600 /etc/postfix/virtual_alias
sudo /usr/sbin/postmap /etc/postfix/virtual_alias
sudo chown root:wheel /etc/postfix/virtual_alias.db
sudo chmod 0644 /etc/postfix/virtual_alias.db
```

Confirm lookup before changing existing permissions, since the exact Postfix service identity may
vary. Never make the source writable by the web service user.

Deploy an alias feature update by rebuilding the web application and replacing the root-owned helper
copy; editing the project checkout does not update the running helper:

```sh
cd /Users/jeonhangyeol/Programming/mailserver
bun install --frozen-lockfile
bun run check
bun test
bun run build
sudo install -o root -g wheel -m 0644 helper/server.ts helper/account-creator.ts helper/account-reader.ts helper/alias-service.ts helper/deleted-account-service.ts helper/status-service.ts helper/trash-service.ts helper/operation-queue.ts /usr/local/libexec/zasoque-mailadmin/app/helper/
sudo install -o root -g wheel -m 0644 src/lib/mail/accounts.ts src/lib/mail/aliases.ts src/lib/mail/deleted.ts src/lib/mail/status.ts src/lib/mail/trash.ts src/lib/mail/config.ts /usr/local/libexec/zasoque-mailadmin/app/src/lib/mail/
sudo launchctl kickstart -k system/org.zasoque.mailadmin.helper
sudo launchctl kickstart -k system/org.zasoque.mailadmin.web
```

Verify aliases after using the authenticated UI:

```sh
sudo /usr/sbin/postmap -q admin@zasoque.org hash:/etc/postfix/virtual_alias
sudo /usr/sbin/postmap -q contact@zasoque.org hash:/etc/postfix/virtual_alias
curl -i https://admin.mail.zasoque.org/api/aliases
```

The unauthenticated curl request must return `401`. Use the browser UI for mutations so administrator
credentials and session cookies are not placed in shell history. After UI changes, repeat the
lookup commands, send an external test message, and verify delivery in the selected mailbox.

## 9. Dashboard and deleted accounts

The authenticated dashboard obtains read-only status from the loopback helper. It probes TCP
listeners on `127.0.0.1` ports 25, 587, 993, and 10027 with a 500 ms timeout. Queue size comes from
the machine-readable `/usr/sbin/postqueue -j` output; queue contents are never returned. Account,
alias, archive, and storage failures are isolated so one unavailable metric does not fail the whole
dashboard.

Deleted mailboxes retain the existing
`/Users/Shared/vmail/.deleted/YYYYMMDDTHHMMSSmmm-address` convention. Restore requires a new
password, rejects account/mailbox/alias conflicts, and rolls the users file and mailbox move back
on failure. Permanent deletion accepts only a validated archive identifier, requires the exact
address confirmation, rejects symlink archive roots and archive entries, and recursively unlinks
symlinks without following them.

After deployment, verify read-only behavior first:

```sh
curl -i http://127.0.0.1:8788/api/status
curl -i http://127.0.0.1:8788/api/deleted
sudo /usr/sbin/postqueue -j
```

The curl requests must return `401` without an authenticated session. Use a disposable test account
for restore and permanent-delete verification; never test those operations against a production
mailbox or archive that must be retained.

## 10. Active-account Trash

Trash management is separate from deleted-account archives. The verified Dovecot configuration has
an inbox namespace with `/` as its separator and no `mailbox_special_use=\\Trash` declaration. The
admin therefore uses the conventional logical mailbox name `Trash` (normally stored as `.Trash` by
Maildir) and first confirms that exact logical name appears in `doveadm mailbox list`. The current
configuration reports `mailbox_autoexpunge=0`, so this feature does not alter or duplicate an
existing automatic-expunge policy.

Status and deletion use fixed argument arrays without a shell:

```text
/opt/homebrew/bin/doveadm mailbox list -u ADDRESS
/opt/homebrew/bin/doveadm -f json mailbox status -u ADDRESS "messages vsize" Trash
/opt/homebrew/bin/doveadm expunge -u ADDRESS mailbox Trash all
```

`ADDRESS` must first pass strict `zasoque.org` validation and be present in the root-readable Dovecot
users file. `Trash` is a server constant, never request input. Expunge is limited by both `mailbox
Trash` and the explicit `all` message-range selector; no filesystem deletion is used. Account
deletion still archives the entire Maildir, including Trash.

For production verification, use only a disposable account and messages:

```sh
sudo /opt/homebrew/bin/doveadm mailbox list -u test@zasoque.org
sudo /opt/homebrew/bin/doveadm -f json mailbox status -u test@zasoque.org "messages vsize" Trash
```

Move known disposable messages to Trash through an IMAP client, inspect the account detail page,
confirm Empty Trash there, and repeat the read-only status command. Never use an operational account
for the destructive verification.
