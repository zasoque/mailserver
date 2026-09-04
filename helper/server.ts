import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AccountCreator, AccountCreatorError } from './account-creator';

const HOST = '127.0.0.1';
const PORT = parsePort(process.env.MAIL_HELPER_PORT);
const MAX_REQUEST_BYTES = 16 * 1024;

const creator = new AccountCreator({
	usersFilePath: '/opt/homebrew/etc/dovecot/users',
	vmailRoot: '/Users/Shared/vmail',
	doveadmPath: '/opt/homebrew/bin/doveadm',
	uid: 500,
	gid: 500
});

const server = createServer(async (request, response) => {
	setSecurityHeaders(response);
	if (!isLoopbackRequest(request)) {
		sendJson(response, 403, { error: { code: 'forbidden', message: 'Loopback access only.' } });
		return;
	}
	if (request.headers.origin !== undefined) {
		sendJson(response, 403, {
			error: { code: 'forbidden', message: 'Browser origins are not allowed.' }
		});
		return;
	}
	const passwordAddress = matchPasswordChangeRoute(request);
	const deleteAddress = matchAccountDeleteRoute(request);
	const isCreateRequest = request.method === 'POST' && request.url === '/accounts';
	if (!isCreateRequest && passwordAddress === null && deleteAddress === null) {
		sendJson(response, 404, { error: { code: 'not_found', message: 'Not found.' } });
		return;
	}
	if (
		deleteAddress === null &&
		!request.headers['content-type']?.toLowerCase().startsWith('application/json')
	) {
		sendJson(response, 415, { error: { code: 'invalid_request', message: 'JSON is required.' } });
		return;
	}

	try {
		if (deleteAddress !== null) {
			const result = await creator.delete(deleteAddress);
			sendJson(response, 200, result);
			console.info(`Deleted mail account ${result.address}; mailbox archived: ${result.mailboxArchived}`);
		} else if (passwordAddress !== null) {
			const body = await readJsonBody(request);
			const result = await creator.changePassword(passwordAddress, body);
			sendJson(response, 200, result);
			console.info(`Changed password for mail account ${result.address}`);
		} else {
			const body = await readJsonBody(request);
			const result = await creator.create(body);
			sendJson(response, 201, result);
			console.info(`Created mail account ${result.address}`);
		}
	} catch (error) {
		if (error instanceof RequestBodyError) {
			sendJson(response, error.status, {
				error: { code: 'invalid_request', message: error.message }
			});
			return;
		}
		if (error instanceof AccountCreatorError) {
			const status =
				error.code === 'account_exists'
					? 409
					: error.code === 'account_not_found'
						? 404
						: error.code === 'protected_account'
							? 403
						: error.code === 'invalid_request'
								? 400
								: 500;
			sendJson(response, status, {
				error: {
					code: error.code,
					message: status === 500 ? 'Mail account operation failed.' : error.message
				}
			});
			console.error(`Mail account operation failed (${error.code}).`);
			return;
		}
		console.error('Unexpected mail account operation failure.');
		sendJson(response, 500, {
			error: { code: 'internal_error', message: 'Mail account operation failed.' }
		});
	}
});

server.listen(PORT, HOST, () => {
	console.info(`Mail account helper listening on http://${HOST}:${PORT}`);
});

function isLoopbackRequest(request: IncomingMessage): boolean {
	return request.socket.localAddress === HOST && request.socket.remoteAddress === HOST;
}

function matchPasswordChangeRoute(request: IncomingMessage): string | null {
	if (request.method !== 'PATCH' || request.url === undefined) return null;
	const match = /^\/accounts\/([^/]+)\/password$/.exec(
		new URL(request.url, 'http://localhost').pathname
	);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return '';
	}
}

function matchAccountDeleteRoute(request: IncomingMessage): string | null {
	if (request.method !== 'DELETE' || request.url === undefined) return null;
	const match = /^\/accounts\/([^/]+)$/.exec(new URL(request.url, 'http://localhost').pathname);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return '';
	}
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_REQUEST_BYTES) throw new RequestBodyError(413, 'Request body is too large.');
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new RequestBodyError(400, 'Invalid JSON.');
	}
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(body));
}

function setSecurityHeaders(response: ServerResponse): void {
	response.setHeader('cache-control', 'no-store');
	response.setHeader('x-content-type-options', 'nosniff');
}

function parsePort(value: string | undefined): number {
	if (value === undefined) return 8787;
	if (!/^\d{1,5}$/.test(value)) throw new Error('MAIL_HELPER_PORT must be a valid TCP port.');
	const port = Number(value);
	if (port < 1 || port > 65535) throw new Error('MAIL_HELPER_PORT must be a valid TCP port.');
	return port;
}

class RequestBodyError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}
