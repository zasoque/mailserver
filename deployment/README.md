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

Generate a bcrypt hash without putting the plaintext password in an argument. At the prompt, type
the password, press Return, and then clear the temporary shell variable:

```sh
read -s MAIL_ADMIN_PLAIN_PASSWORD
printf '%s' "$MAIL_ADMIN_PLAIN_PASSWORD" | bun run hash-admin-password
unset MAIL_ADMIN_PLAIN_PASSWORD
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
sudo install -o root -g wheel -m 0644 helper/server.ts helper/account-creator.ts helper/account-reader.ts /usr/local/libexec/zasoque-mailadmin/app/helper/
sudo install -o root -g wheel -m 0644 src/lib/mail/accounts.ts src/lib/mail/config.ts /usr/local/libexec/zasoque-mailadmin/app/src/lib/mail/
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

The web process no longer reads this file; only Dovecot and the root helper need access. For the
current root-managed Dovecot setup, use:

```sh
sudo chown root:wheel /opt/homebrew/etc/dovecot/users
sudo chmod 0600 /opt/homebrew/etc/dovecot/users
sudo doveadm auth test jeonhangyeol@zasoque.org
```

If Dovecot authentication fails after tightening permissions, its auth worker is configured to run
as a non-root identity. In that case, use a dedicated Dovecot group rather than world-readable mode:

```sh
sudo chown root:dovecot /opt/homebrew/etc/dovecot/users
sudo chmod 0640 /opt/homebrew/etc/dovecot/users
```

Confirm the actual local Dovecot group name before using the second form. Never restore `0644` or
another world-readable mode.

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
