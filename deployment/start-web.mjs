import { readFileSync, statSync } from 'node:fs';

if (process.env.MAIL_ADMIN_CONFIG_FILE) loadSecretConfig(process.env.MAIL_ADMIN_CONFIG_FILE);

process.env.NODE_ENV = 'production';
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '8788';
process.env.MAIL_HELPER_PORT ??= '8787';

if (process.env.HOST !== '127.0.0.1') {
	throw new Error('The Mail Admin web server may only bind to 127.0.0.1.');
}

for (const name of [
	'MAIL_ADMIN_USERNAME',
	'MAIL_ADMIN_PASSWORD_HASH',
	'MAIL_ADMIN_SESSION_SECRET'
]) {
	if (!process.env[name]) throw new Error(`Required authentication setting ${name} is missing.`);
}

await import('../build/index.js');

function loadSecretConfig(filePath) {
	const metadata = statSync(filePath);
	if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
		throw new Error('The Mail Admin secret config must be a regular file with mode 0600.');
	}
	if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
		throw new Error('The Mail Admin secret config must be owned by the web service user.');
	}
	const allowed = new Set([
		'MAIL_ADMIN_USERNAME',
		'MAIL_ADMIN_PASSWORD_HASH',
		'MAIL_ADMIN_SESSION_SECRET'
	]);
	for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const separator = line.indexOf('=');
		if (separator < 1) throw new Error('Invalid Mail Admin secret config line.');
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1);
		if (!allowed.has(key) || value === '')
			throw new Error('Invalid Mail Admin secret config entry.');
		process.env[key] = value;
	}
}
