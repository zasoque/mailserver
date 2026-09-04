import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { EmptyTrashResponse, TrashStatus } from '../src/lib/mail/trash';
import { AccountCreatorError, validateAddress } from './account-creator';
import { OperationQueue } from './operation-queue';

const TRASH_MAILBOX = 'Trash' as const;

export interface TrashServiceOptions {
	usersFilePath: string;
	doveadmPath: string;
}

export interface TrashServiceDependencies {
	operationQueue?: OperationQueue;
	runDoveadm?: (args: readonly string[]) => Promise<string>;
}

export class TrashService {
	private readonly operationQueue: OperationQueue;
	private readonly runDoveadm: (args: readonly string[]) => Promise<string>;

	constructor(
		private readonly options: TrashServiceOptions,
		dependencies: TrashServiceDependencies = {}
	) {
		this.operationQueue = dependencies.operationQueue ?? new OperationQueue();
		this.runDoveadm = dependencies.runDoveadm ?? ((args) => runDoveadm(options.doveadmPath, args));
	}

	async status(addressInput: unknown): Promise<TrashStatus> {
		const address = validateAddress(addressInput);
		await this.assertRealAccount(address);
		return this.readStatus(address);
	}

	empty(addressInput: unknown, input: unknown): Promise<EmptyTrashResponse> {
		const address = validateAddress(addressInput);
		if (!isConfirmed(input)) {
			throw new AccountCreatorError('invalid_request', 'Empty Trash must be explicitly confirmed.');
		}
		return this.operationQueue.run(async () => {
			await this.assertRealAccount(address);
			const current = await this.readStatus(address);
			if (current.exists && current.messages > 0) {
				try {
					await this.runDoveadm(['expunge', '-u', address, 'mailbox', TRASH_MAILBOX, 'all']);
				} catch (error) {
					console.error(`doveadm Trash expunge failed for ${address}: ${safeMessage(error)}`);
					throw new AccountCreatorError('trash_operation_failed', 'Could not empty Trash.', {
						cause: error
					});
				}
			}
			const result = await this.readStatus(address);
			if (result.messages !== 0) {
				throw new AccountCreatorError(
					'trash_operation_failed',
					'Trash still contains messages after expunge.'
				);
			}
			return { address, ...result, emptied: true };
		});
	}

	async totalBytes(addresses: readonly string[]): Promise<number> {
		let total = 0;
		for (const address of addresses) total += (await this.status(address)).bytes;
		return total;
	}

	private async readStatus(address: string): Promise<TrashStatus> {
		let mailboxes: string;
		try {
			mailboxes = await this.runDoveadm(['mailbox', 'list', '-u', address]);
		} catch (error) {
			console.error(
				`doveadm Trash mailbox inspection failed for ${address}: ${safeMessage(error)}`
			);
			throw new AccountCreatorError('trash_operation_failed', 'Could not inspect Trash.', {
				cause: error
			});
		}
		const exists = mailboxes.split(/\r?\n/).some((mailbox) => mailbox === TRASH_MAILBOX);
		if (!exists) return { mailbox: TRASH_MAILBOX, exists: false, messages: 0, bytes: 0 };

		try {
			const output = await this.runDoveadm([
				'-f',
				'json',
				'mailbox',
				'status',
				'-u',
				address,
				'messages vsize',
				TRASH_MAILBOX
			]);
			const record = parseStatus(output);
			return { mailbox: TRASH_MAILBOX, exists: true, ...record };
		} catch (error) {
			if (error instanceof AccountCreatorError) throw error;
			console.error(`doveadm Trash status failed for ${address}: ${safeMessage(error)}`);
			throw new AccountCreatorError('trash_operation_failed', 'Could not inspect Trash.', {
				cause: error
			});
		}
	}

	private async assertRealAccount(address: string): Promise<void> {
		const users = await readFile(this.options.usersFilePath, 'utf8');
		const exists = users.split(/\r?\n/).some((line) => {
			const separator = line.indexOf(':');
			return separator !== -1 && line.slice(0, separator).trim() === address;
		});
		if (!exists) {
			throw new AccountCreatorError(
				'account_not_found',
				'Trash is available only for an active mail account.'
			);
		}
	}
}

function parseStatus(output: string): { messages: number; bytes: number } {
	const value: unknown = JSON.parse(output);
	const record = Array.isArray(value) ? value[0] : value;
	if (typeof record !== 'object' || record === null) throw new Error('Missing status record.');
	const messages = numericField(record, 'messages');
	const bytes = numericField(record, 'vsize');
	return { messages, bytes };
}

function numericField(record: object, key: string): number {
	const value = key in record ? (record as Record<string, unknown>)[key] : undefined;
	const number =
		typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${key}.`);
	return number;
}

function isConfirmed(input: unknown): input is { confirmed: true } {
	return (
		typeof input === 'object' && input !== null && 'confirmed' in input && input.confirmed === true
	);
}

async function runDoveadm(doveadmPath: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(doveadmPath, [...args], {
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			if (!settled) {
				settled = true;
				reject(new Error('doveadm timed out.'));
			}
		}, 30_000);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			if (stdout.length < 1024 * 1024) stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			if (stderr.length < 8192) stderr += chunk;
		});
		child.once('error', (error) => finish(() => reject(error)));
		child.once('close', (code) =>
			finish(() =>
				code === 0
					? resolve(stdout)
					: reject(new Error(`doveadm exited with code ${code}: ${stderr.slice(0, 2048)}`))
			)
		);

		function finish(result: () => void) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			result();
		}
	});
}

function safeMessage(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 2048) : 'unknown error';
}
