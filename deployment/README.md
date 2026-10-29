# Production deployment on macOS

The web application and privileged helper listen on IPv4 loopback only:

- Web: `127.0.0.1:8788` (configurable with `HOST`/`PORT`, but the launcher rejects non-loopback `HOST`)
- Helper: `127.0.0.1:8787` (configurable with `MAIL_HELPER_PORT`)

The web service is a system LaunchDaemon with `UserName=jeonhangyeol`, rather than a LaunchAgent.
This starts at boot before login while keeping the web process unprivileged. The helper is a separate
root LaunchDaemon.

## 1. Build and verify

From `/Users/jeonhangyeol/Documents/Programming/mailserver`:

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

Do not run root directly from a user-writable project or from the user-owned Bun executable. Use the
staging script rather than maintaining a manual module list. It installs every non-test
`helper/*.ts` runtime module (including future additions), every shared `src/lib/mail/*.ts` module,
and a root-owned Bun copy. It then resolves the staged `server.ts` import graph without executing the
server; deployment fails immediately if any dependency is missing.

```sh
cd /Users/jeonhangyeol/Documents/Programming/mailserver
command -v bun
sudo deployment/stage-helper.sh "$(command -v bun)"
```

Repeat this command after helper code or Bun is upgraded, then restart the helper. The script already
runs the dependency check, but it can also be repeated independently before or after restart:

```sh
deployment/verify-helper-deployment.sh
```

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
cd /Users/jeonhangyeol/Documents/Programming/mailserver
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

The canonical application-managed map is:

```text
source:   /usr/local/var/zasoque-mailadmin/postfix/virtual_alias       root:wheel 0600
database: /usr/local/var/zasoque-mailadmin/postfix/virtual_alias.db    root:_postfix 0640
directory:/usr/local/var/zasoque-mailadmin/postfix                     root:_postfix 0750
backup:   /var/backups/zasoque-mailadmin/postfix                       root:wheel 0700
```

`postconf -h mail_owner` reports `_postfix`, and the `cleanup` service is non-privileged. The
directory group/execute bit and database group/read bit therefore permit only root and Postfix to
traverse/read the lookup database; the source and backups remain root-only. Never weaken `/etc`,
disable SIP/TCC, or make these paths world-writable.

The helper writes a durable external backup, creates a `0600` temporary file beside the new source,
fsyncs it, reapplies the source owner/mode, atomically renames it over the fixed canonical path, and
fsyncs the directory. It then runs `/usr/sbin/postmap` using an argument array and normalizes the DB
to `root:_postfix 0640`. Mutations share one queue. If postmap fails, the old source is restored by
the same atomic operation and postmap is run again; the request is never reported as successful.
Backups are not automatically expired.

Startup preflight validates both fixed directories and the non-symlink, owner-only regular source,
opens the source read-only, and creates/chmods/fsyncs/removes temporary probes without changing the
source. Failure stops the helper and logs a safe diagnostic.

### Existing installation migration

Stage code/directories, then explicitly prepare the new map. Staging alone never creates or
overwrites the production source. Dry-run and migrate as follows:

```sh
sudo deployment/stage-helper.sh "$(command -v bun)"
sudo deployment/migrate-virtual-alias-map.sh --dry-run
sudo deployment/migrate-virtual-alias-map.sh
sudo /usr/sbin/postmap -q admin@zasoque.org hash:/etc/postfix/virtual_alias
sudo /usr/sbin/postmap -q admin@zasoque.org hash:/usr/local/var/zasoque-mailadmin/postfix/virtual_alias
```

The script refuses a symlink/missing old source and refuses to overwrite a differing destination.
It copies exact contents, builds the new DB, compares old/new lookup results, and does **not** run
`postconf`, `postfix check`, or reload. It leaves `/etc/postfix/virtual_alias{,.db}` untouched.

Only after both lookups match, cut over manually:

```sh
sudo /usr/sbin/postconf -e 'virtual_alias_maps = hash:/usr/local/var/zasoque-mailadmin/postfix/virtual_alias'
sudo /usr/sbin/postfix check
sudo /usr/sbin/postfix reload
/usr/sbin/postconf -h virtual_alias_maps
sudo /usr/sbin/postmap -q admin@zasoque.org hash:/usr/local/var/zasoque-mailadmin/postfix/virtual_alias
```

Then verify actual external delivery before exercising Alias CRUD in Mail Admin. If anything fails,
rollback to the preserved old map:

```sh
sudo /usr/sbin/postconf -e 'virtual_alias_maps = hash:/etc/postfix/virtual_alias'
sudo /usr/sbin/postfix check
sudo /usr/sbin/postfix reload
/usr/sbin/postconf -h virtual_alias_maps
sudo /usr/sbin/postmap -q admin@zasoque.org hash:/etc/postfix/virtual_alias
```

### Fresh installation

With no legacy map to migrate, stage using the explicit fresh-install flag, generate the empty DB,
then configure Postfix only after lookup/configuration checks:

```sh
sudo deployment/stage-helper.sh --fresh-alias-source "$(command -v bun)"
sudo /usr/sbin/postmap /usr/local/var/zasoque-mailadmin/postfix/virtual_alias
sudo chown root:_postfix /usr/local/var/zasoque-mailadmin/postfix/virtual_alias.db
sudo chmod 0640 /usr/local/var/zasoque-mailadmin/postfix/virtual_alias.db
```

Any separate full-server rebuild guide must also replace the old `/etc/postfix/virtual_alias`
canonical path with `/usr/local/var/zasoque-mailadmin/postfix/virtual_alias`.

Deploy an alias feature update by rebuilding the web application and replacing the root-owned helper
copy; editing the project checkout does not update the running helper:

```sh
cd /Users/jeonhangyeol/Documents/Programming/mailserver
bun install --frozen-lockfile
bun run check
bun test
bun run build
sudo deployment/stage-helper.sh "$(command -v bun)"
deployment/verify-helper-deployment.sh
sudo launchctl kickstart -k system/org.zasoque.mailadmin.helper
sudo launchctl kickstart -k system/org.zasoque.mailadmin.web
```

Verify aliases after using the authenticated UI:

```sh
sudo /usr/sbin/postmap -q admin@zasoque.org hash:/usr/local/var/zasoque-mailadmin/postfix/virtual_alias
sudo /usr/sbin/postmap -q contact@zasoque.org hash:/usr/local/var/zasoque-mailadmin/postfix/virtual_alias
curl -i https://admin.mail.zasoque.org/api/aliases
```

The unauthenticated curl request must return `401`. Use the browser UI for mutations so administrator
credentials and session cookies are not placed in shell history. After UI changes, repeat the
lookup commands, send an external test message, and verify delivery in the selected mailbox.

## 9. Alias sender identities

The generated sender ownership map is derived exclusively from active Dovecot accounts and the
canonical virtual-alias source:

```text
/usr/local/var/zasoque-mailadmin/postfix/sender_login       root:_postfix 0640
/usr/local/var/zasoque-mailadmin/postfix/sender_login.db    root:_postfix 0640

# sender address                 permitted SASL login
alice@zasoque.org                alice@zasoque.org
hello@zasoque.org                alice@zasoque.org
```

Every active account owns itself; each alias is owned by its active destination. Deleted accounts
are absent. Account create/delete/restore and alias create/update/delete rebuild this generated map
inside the same serialized operation. Source replacement is atomic and externally backed up; a
postmap failure restores and rebuilds the old map. Rebuild it explicitly after staging:

```sh
sudo deployment/rebuild-sender-login-map.sh
sudo /usr/sbin/postmap -q alice@zasoque.org \
  hash:/usr/local/var/zasoque-mailadmin/postfix/sender_login
sudo /usr/sbin/postmap -q hello@zasoque.org \
  hash:/usr/local/var/zasoque-mailadmin/postfix/sender_login
```

The local Postfix has `_postfix` as `mail_owner`; the DB therefore uses the same restricted
`root:_postfix 0640` policy as `virtual_alias.db`.

### Submission enforcement and the visible From header

Postfix `smtpd_sender_login_maps` maps an envelope sender to permitted SASL login names.
`reject_authenticated_sender_login_mismatch` rejects authenticated clients that use an unlisted
MAIL FROM or do not own the listed sender. Apply this only to the submission service, not the port
25 inbound service. Add these overrides to the existing `submission` entry in `master.cf`:

```text
  -o smtpd_sender_login_maps=hash:/usr/local/var/zasoque-mailadmin/postfix/sender_login
  -o smtpd_sender_restrictions=reject_authenticated_sender_login_mismatch
```

The repository's `senderauth` Go Milter performs the complementary RFC 5322 `From:` ownership check.
It uses `github.com/emersion/go-milter` for protocol handling, Go `net/mail` for mailbox parsing,
and the trusted `{auth_authen}` Postfix macro. It listens only on `127.0.0.1:10029`, runs as
`_postfix`, never reads message bodies, and reloads the atomically replaced `sender_login` source at
end-of-headers. Missing authentication, malformed/duplicate/multiple From, unavailable or unsafe
maps, unknown senders, and ownership mismatch reject or tempfail closed. It requires ownership, not
literal equality between MAIL FROM and From.

Build, stage, verify, and install the daemon without changing Postfix:

```sh
bun run build:senderauth
sudo deployment/stage-senderauth.sh "$PWD/senderauth/build/senderauth"
sudo deployment/verify-senderauth-deployment.sh
plutil -lint deployment/launchd/org.zasoque.senderauth.plist
sudo install -o root -g wheel -m 0644 deployment/launchd/org.zasoque.senderauth.plist \
  /Library/LaunchDaemons/org.zasoque.senderauth.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/org.zasoque.senderauth.plist
```

The existing `content_filter=dkimsign:127.0.0.1:10027` remains after Milter acceptance. Port 25 and
DKIM reinjection port 10028 must not receive this Milter. Add these overrides only to `submission`:

```text
  -o smtpd_sender_login_maps=hash:/usr/local/var/zasoque-mailadmin/postfix/sender_login
  -o smtpd_sender_restrictions=reject_authenticated_sender_login_mismatch
  -o smtpd_milters=inet:127.0.0.1:10029
  -o milter_protocol=6
  -o milter_default_action=tempfail
  -o milter_end_of_header_macros={auth_authen}
```

Then validate configuration and reload manually:

```sh
sudo /usr/sbin/postfix check
sudo /usr/sbin/postfix reload
/usr/sbin/postconf -M submission/inet
```

Rollback the Milter independently by removing the four Milter-related submission overrides. Remove
the two sender-login overrides separately to roll back envelope enforcement. Then run `postfix
check` and `postfix reload`.

### SMTP tests

Use a disposable account and `swaks` if installed. Supply passwords interactively or through a
permission-restricted temporary mechanism; never place them in shell history:

```sh
swaks --server mail.zasoque.org:587 --tls --auth LOGIN \
  --auth-user alice@zasoque.org --from hello@zasoque.org \
  --header 'From: hello@zasoque.org' --to alice@zasoque.org

swaks --server mail.zasoque.org:587 --tls --auth LOGIN \
  --auth-user alice@zasoque.org --from admin@zasoque.org \
  --header 'From: admin@zasoque.org' --to alice@zasoque.org
```

The first must be accepted when `hello` belongs to Alice. The second must return a 5xx sender-login
mismatch when `admin` belongs to Bob. Also test an arbitrary local address and a foreign-domain
sender; both must be rejected. Once the Milter is present, test a permitted MAIL FROM with a
different visible From and require rejection before queueing.

In Apple Mail, select Mail → Settings → Accounts → Account Information, open the Email Address menu,
choose Edit Email Addresses, and add the aliases. Keep the outgoing server and authentication set
to the real account. The aliases then appear in the compose window's From menu. Client-side setup
does not replace server enforcement.

For a delivered alias message, inspect Authentication-Results or the recipient provider's original
message view and require SPF pass, DKIM pass with `d=zasoque.org`, and DMARC pass/alignment. Compare
the envelope sender, visible From, and DKIM domain. The current DKIM content filter remains unchanged.

## 10. Dashboard and deleted accounts

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

## 11. Active-account Trash

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
