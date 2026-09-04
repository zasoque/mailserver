# Mail server administration

SvelteKit administration UI and a separate privileged helper for the local Dovecot/Postfix mail
server.

## Development

```sh
bun install
bun run dev
```

The web application connects only to `http://127.0.0.1:8787`. A different loopback port can be
selected for both processes with `MAIL_HELPER_PORT`.

## Privileged account helper

The helper is intentionally separate from SvelteKit. It has fixed production paths and listens on
IPv4 loopback only:

- Dovecot users: `/opt/homebrew/etc/dovecot/users`
- Virtual mail root: `/Users/Shared/vmail`
- Dovecot CLI: `/opt/homebrew/bin/doveadm`
- Listener: `127.0.0.1:8787`

Run it manually from the project directory with root privileges, then run the SvelteKit application
as its normal unprivileged service user:

```sh
sudo bun run helper
bun run dev
```

Open `/accounts/new` and submit the form to perform an end-to-end account creation. The helper does
not accept browser-origin requests; the form talks to SvelteKit, which forwards the validated JSON
over loopback. Do not run the SvelteKit command with `sudo`.

Run the safe temporary-directory test suite without root privileges:

```sh
bun test
bun run check
```

The tests use an injected password hasher and chown implementation. They never modify the real
Dovecot users file or vmail tree.

## Original SvelteKit template notes

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
bun x sv@0.17.0 create --template minimal --types ts --add prettier --install bun .
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
