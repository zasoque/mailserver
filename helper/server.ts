import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AccountCreator, AccountCreatorError } from './account-creator';
import { AccountReader } from './account-reader';
import { AliasService } from './alias-service';
import { DeletedAccountService } from './deleted-account-service';
import { OperationQueue } from './operation-queue';
import { SenderLoginService } from './sender-login-service';
import { StatusService } from './status-service';
import { TrashService } from './trash-service';

const HOST = '127.0.0.1';
const PORT = parsePort(process.env.MAIL_HELPER_PORT);
const MAX_REQUEST_BYTES = 16 * 1024;

const operationQueue = new OperationQueue();
const senderLoginService = new SenderLoginService({
	usersFilePath: '/opt/homebrew/etc/dovecot/users',
	aliasFilePath: '/usr/local/var/zasoque-mailadmin/postfix/virtual_alias',
	senderLoginFilePath: '/usr/local/var/zasoque-mailadmin/postfix/sender_login',
	backupDirectoryPath: '/var/backups/zasoque-mailadmin/postfix',
	postmapPath: '/usr/sbin/postmap'
});
const synchronizeSenderLogin = () => senderLoginService.rebuildFromSources();
const creator = new AccountCreator(
	{
		usersFilePath: '/opt/homebrew/etc/dovecot/users',
		vmailRoot: '/Users/Shared/vmail',
		doveadmPath: '/opt/homebrew/bin/doveadm',
		virtualAliasFilePath: '/usr/local/var/zasoque-mailadmin/postfix/virtual_alias',
		uid: 500,
		gid: 500
	},
	{ operationQueue, synchronizeSenderLogin }
);
const reader = new AccountReader('/opt/homebrew/etc/dovecot/users', '/Users/Shared/vmail');
const aliasService = new AliasService(
	{
		aliasFilePath: '/usr/local/var/zasoque-mailadmin/postfix/virtual_alias',
		usersFilePath: '/opt/homebrew/etc/dovecot/users',
		postmapPath: '/usr/sbin/postmap',
		backupDirectoryPath: '/var/backups/zasoque-mailadmin/postfix'
	},
	{ operationQueue, synchronizeSenderLogin }
);
const deletedAccountService = new DeletedAccountService(
	{
		usersFilePath: '/opt/homebrew/etc/dovecot/users',
		vmailRoot: '/Users/Shared/vmail',
		virtualAliasFilePath: '/usr/local/var/zasoque-mailadmin/postfix/virtual_alias',
		doveadmPath: '/opt/homebrew/bin/doveadm',
		uid: 500,
		gid: 500
	},
	{ operationQueue, synchronizeSenderLogin }
);
const trashService = new TrashService(
	{
		usersFilePath: '/opt/homebrew/etc/dovecot/users',
		doveadmPath: '/opt/homebrew/bin/doveadm'
	},
	{ operationQueue }
);
const statusService = new StatusService(reader, aliasService, deletedAccountService, trashService, {
	postqueuePath: '/usr/sbin/postqueue'
});

try {
	await aliasService.verifyMutationAccess();
	await senderLoginService.verifyMutationAccess();
	console.info('Alias mutation preflight passed.');
} catch (error) {
	console.error('Alias mutation preflight failed.', safeErrorDetails(error));
	process.exit(1);
}

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
	const aliasAddress = matchAliasRoute(request);
	const deletedRoute = matchDeletedRoute(request);
	const trashAddress = matchTrashRoute(request);
	const isListRequest = request.method === 'GET' && request.url === '/accounts';
	const isCreateRequest = request.method === 'POST' && request.url === '/accounts';
	const isAliasListRequest = request.method === 'GET' && request.url === '/aliases';
	const isAliasCreateRequest = request.method === 'POST' && request.url === '/aliases';
	const isStatusRequest = request.method === 'GET' && request.url === '/status';
	const isDeletedListRequest = request.method === 'GET' && request.url === '/deleted';
	if (
		!isListRequest &&
		!isCreateRequest &&
		!isAliasListRequest &&
		!isAliasCreateRequest &&
		!isStatusRequest &&
		!isDeletedListRequest &&
		passwordAddress === null &&
		deleteAddress === null &&
		aliasAddress === null &&
		deletedRoute === null &&
		trashAddress === null
	) {
		sendJson(response, 404, { error: { code: 'not_found', message: 'Not found.' } });
		return;
	}
	if (
		!isListRequest &&
		!isAliasListRequest &&
		!isStatusRequest &&
		!isDeletedListRequest &&
		!(request.method === 'GET' && trashAddress !== null) &&
		deleteAddress === null &&
		!(request.method === 'DELETE' && aliasAddress !== null) &&
		!request.headers['content-type']?.toLowerCase().startsWith('application/json')
	) {
		sendJson(response, 415, { error: { code: 'invalid_request', message: 'JSON is required.' } });
		return;
	}

	try {
		if (isListRequest) {
			sendJson(response, 200, await reader.list());
		} else if (trashAddress !== null && request.method === 'GET') {
			sendJson(response, 200, await trashService.status(trashAddress));
		} else if (trashAddress !== null && request.method === 'DELETE') {
			const result = await trashService.empty(trashAddress, await readJsonBody(request));
			sendJson(response, 200, result);
			console.info(`Emptied Trash for mail account ${result.address}`);
		} else if (isStatusRequest) {
			sendJson(response, 200, await statusService.get());
		} else if (isDeletedListRequest) {
			sendJson(response, 200, await deletedAccountService.list());
		} else if (deletedRoute !== null && deletedRoute.action === 'restore') {
			const result = await deletedAccountService.restore(
				deletedRoute.id,
				await readJsonBody(request)
			);
			sendJson(response, 200, result);
			console.info(`Restored mail account ${result.address} from archive ${result.id}`);
		} else if (deletedRoute !== null && deletedRoute.action === 'delete') {
			const result = await deletedAccountService.permanentlyDelete(
				deletedRoute.id,
				await readJsonBody(request)
			);
			sendJson(response, 200, result);
			console.info(
				`Permanently deleted archived mailbox ${result.address} (${result.usageBytes ?? 'unknown'} bytes)`
			);
		} else if (isAliasListRequest) {
			sendJson(response, 200, await aliasService.list());
		} else if (isAliasCreateRequest) {
			const result = await aliasService.create(await readJsonBody(request));
			sendJson(response, 201, result);
			console.info(`Created alias ${result.address} -> ${result.destination}`);
		} else if (aliasAddress !== null && request.method === 'PATCH') {
			const result = await aliasService.update(aliasAddress, await readJsonBody(request));
			sendJson(response, 200, result);
			console.info(`Updated alias ${result.address} -> ${result.destination}`);
		} else if (aliasAddress !== null && request.method === 'DELETE') {
			const result = await aliasService.delete(aliasAddress);
			sendJson(response, 200, result);
			console.info(`Deleted alias ${result.address} -> ${result.destination}`);
		} else if (deleteAddress !== null) {
			const result = await creator.delete(deleteAddress);
			sendJson(response, 200, result);
			console.info(
				`Deleted mail account ${result.address}; mailbox archived: ${result.mailboxArchived}`
			);
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
						: error.code === 'archive_not_found'
							? 404
							: error.code === 'alias_not_found' || error.code === 'destination_not_found'
								? 404
								: error.code === 'alias_exists' ||
									  error.code === 'account_address_conflict' ||
									  error.code === 'alias_in_use' ||
									  error.code === 'archive_conflict'
									? 409
									: error.code === 'protected_account'
										? 403
										: error.code === 'protected_alias'
											? 403
											: error.code === 'invalid_request' || error.code === 'confirmation_mismatch'
												? 400
												: 500;
			if (error.code === 'protected_account') {
				sendJson(response, status, { error: error.message });
			} else {
				sendJson(response, status, {
					error: {
						code: error.code,
						message:
							status === 500 && error.code !== 'trash_operation_failed'
								? 'Mail account operation failed.'
								: error.message
					}
				});
			}
			console.error(`Mail account operation failed (${error.code}).`);
			return;
		}
		console.error('Unexpected mail account operation failure.', safeErrorDetails(error));
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

function matchTrashRoute(request: IncomingMessage): string | null {
	if ((request.method !== 'GET' && request.method !== 'DELETE') || request.url === undefined) {
		return null;
	}
	const match = /^\/accounts\/([^/]+)\/trash$/.exec(
		new URL(request.url, 'http://localhost').pathname
	);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return '';
	}
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

function matchAliasRoute(request: IncomingMessage): string | null {
	if ((request.method !== 'PATCH' && request.method !== 'DELETE') || request.url === undefined) {
		return null;
	}
	const match = /^\/aliases\/([^/]+)$/.exec(new URL(request.url, 'http://localhost').pathname);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return '';
	}
}

function matchDeletedRoute(
	request: IncomingMessage
): { id: string; action: 'restore' | 'delete' } | null {
	if (request.url === undefined) return null;
	const pathname = new URL(request.url, 'http://localhost').pathname;
	const restore = request.method === 'POST' ? /^\/deleted\/([^/]+)\/restore$/.exec(pathname) : null;
	const deletion = request.method === 'DELETE' ? /^\/deleted\/([^/]+)$/.exec(pathname) : null;
	const match = restore ?? deletion;
	if (!match) return null;
	try {
		return {
			id: decodeURIComponent(match[1]),
			action: restore ? 'restore' : 'delete'
		};
	} catch {
		return { id: '', action: restore ? 'restore' : 'delete' };
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

function safeErrorDetails(error: unknown): Record<string, string> {
	if (!(error instanceof Error)) return { type: typeof error };
	const details: Record<string, string> = {
		name: error.name,
		message: error.message.slice(0, 2048)
	};
	if ('code' in error && typeof error.code === 'string') details.code = error.code;
	if ('syscall' in error && typeof error.syscall === 'string') details.syscall = error.syscall;
	return details;
}

class RequestBodyError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
	}
}
