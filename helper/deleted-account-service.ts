import {
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rmdir,
	stat,
	unlink
} from 'node:fs/promises';
import path from 'node:path';
import type {
	DeletedAccountArchive,
	DeletedAccountsResponse,
	PermanentlyDeleteArchiveResponse,
	RestoreDeletedAccountResponse
} from '../src/lib/mail/deleted';
import {
	AccountCreatorError,
	appendUsersEntry,
	atomicWrite,
	chownDirectoryTree,
	createTimestampedBackup,
	hashPasswordWithDoveadm,
	validateAddress,
	validateChangePasswordRequest
} from './account-creator';
import { directorySize } from './account-reader';
import { parseAliasSource } from './alias-service';
import { OperationQueue } from './operation-queue';

const ARCHIVE_PATTERN = /^(\d{8}T\d{9})-([a-z0-9._-]{1,64}@zasoque\.org)$/;

export interface DeletedAccountServiceOptions {
	usersFilePath: string;
	vmailRoot: string;
	virtualAliasFilePath: string;
	doveadmPath: string;
	uid: number;
	gid: number;
}

export interface DeletedAccountServiceDependencies {
	operationQueue?: OperationQueue;
	hashPassword?: (password: string) => Promise<string>;
	chownTree?: (target: string, uid: number, gid: number) => Promise<void>;
	moveMailbox?: (source: string, destination: string) => Promise<void>;
}

export class DeletedAccountService {
	private readonly operationQueue: OperationQueue;
	private readonly hashPassword: (password: string) => Promise<string>;
	private readonly chownTree: (target: string, uid: number, gid: number) => Promise<void>;
	private readonly moveMailbox: (source: string, destination: string) => Promise<void>;

	constructor(
		private readonly options: DeletedAccountServiceOptions,
		dependencies: DeletedAccountServiceDependencies = {}
	) {
		this.operationQueue = dependencies.operationQueue ?? new OperationQueue();
		this.hashPassword =
			dependencies.hashPassword ??
			((password) => hashPasswordWithDoveadm(options.doveadmPath, password));
		this.chownTree = dependencies.chownTree ?? chownDirectoryTree;
		this.moveMailbox = dependencies.moveMailbox ?? rename;
	}

	list(): Promise<DeletedAccountsResponse> {
		return this.operationQueue.run(async () => {
			const root = await this.safeArchiveRoot(false);
			if (root === null) return { archives: [] };
			const archives: DeletedAccountArchive[] = [];
			for (const entry of await readdir(root, { withFileTypes: true })) {
				if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
				const parsed = parseArchiveId(entry.name);
				if (parsed === null) continue;
				const archivePath = await this.safeArchivePath(root, entry.name);
				archives.push({
					id: entry.name,
					address: parsed.address,
					deletedAt: parsed.deletedAt,
					usageBytes: await directorySize(archivePath)
				});
			}
			archives.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
			return { archives };
		});
	}

	restore(id: unknown, input: unknown): Promise<RestoreDeletedAccountResponse> {
		const archiveId = validateArchiveId(id);
		const request = validateChangePasswordRequest(input);
		return this.operationQueue.run(async () => {
			const root = await this.requireArchiveRoot();
			const parsed = parseArchiveId(archiveId)!;
			const archivePath = await this.safeArchivePath(root, archiveId);
			const username = parsed.address.slice(0, parsed.address.indexOf('@'));
			const destination = path.resolve(this.options.vmailRoot, 'zasoque.org', username);
			const domainRoot = path.resolve(this.options.vmailRoot, 'zasoque.org');
			if (!destination.startsWith(`${domainRoot}${path.sep}`)) {
				throw new AccountCreatorError('invalid_request', 'Unsafe restore destination.');
			}

			const originalUsers = await readFile(this.options.usersFilePath, 'utf8');
			if (containsAddress(originalUsers, parsed.address)) {
				throw new AccountCreatorError('account_exists', 'The mail account already exists.');
			}
			if (await exists(destination)) {
				throw new AccountCreatorError(
					'archive_conflict',
					'The mailbox restore destination already exists.'
				);
			}
			const aliases = parseAliasSource(await readFile(this.options.virtualAliasFilePath, 'utf8'));
			if (aliases.some((alias) => alias.address === parsed.address)) {
				throw new AccountCreatorError(
					'account_address_conflict',
					'An alias already exists with this address. Delete the alias before restoring.'
				);
			}

			const passwordHash = await this.hashPassword(request.password);
			const usersMetadata = await stat(this.options.usersFilePath);
			await createTimestampedBackup(this.options.usersFilePath);
			await mkdir(domainRoot, { recursive: true });
			let mailboxMoved = false;
			let usersWriteStarted = false;
			try {
				await this.moveMailbox(archivePath, destination);
				mailboxMoved = true;
				usersWriteStarted = true;
				await atomicWrite(
					this.options.usersFilePath,
					appendUsersEntry(originalUsers, parsed.address, passwordHash),
					usersMetadata.mode,
					usersMetadata.uid,
					usersMetadata.gid
				);
				await this.chownTree(destination, this.options.uid, this.options.gid);
			} catch (error) {
				let rollbackFailed = false;
				if (usersWriteStarted) {
					try {
						await atomicWrite(
							this.options.usersFilePath,
							originalUsers,
							usersMetadata.mode,
							usersMetadata.uid,
							usersMetadata.gid
						);
					} catch {
						rollbackFailed = true;
					}
				}
				if (mailboxMoved) {
					try {
						await this.moveMailbox(destination, archivePath);
					} catch {
						rollbackFailed = true;
					}
				}
				if (rollbackFailed) console.error('Account restore rollback was incomplete.');
				if (error instanceof AccountCreatorError) throw error;
				throw new AccountCreatorError('filesystem_error', 'Account restore failed.', {
					cause: error
				});
			}
			return { id: archiveId, address: parsed.address, restored: true };
		});
	}

	permanentlyDelete(id: unknown, input: unknown): Promise<PermanentlyDeleteArchiveResponse> {
		const archiveId = validateArchiveId(id);
		const confirmation = validateConfirmation(input);
		return this.operationQueue.run(async () => {
			const root = await this.requireArchiveRoot();
			const parsed = parseArchiveId(archiveId)!;
			if (confirmation !== parsed.address) {
				throw new AccountCreatorError(
					'confirmation_mismatch',
					'Type the complete account address to confirm permanent deletion.'
				);
			}
			const archivePath = await this.safeArchivePath(root, archiveId);
			const usageBytes = await directorySize(archivePath);
			await safeRecursiveDelete(archivePath, root);
			return {
				id: archiveId,
				address: parsed.address,
				usageBytes,
				permanentlyDeleted: true
			};
		});
	}

	private async requireArchiveRoot(): Promise<string> {
		const root = await this.safeArchiveRoot(false);
		if (root === null) {
			throw new AccountCreatorError('archive_not_found', 'The mailbox archive does not exist.');
		}
		return root;
	}

	private async safeArchiveRoot(create: boolean): Promise<string | null> {
		const root = path.resolve(this.options.vmailRoot, '.deleted');
		if (create) await mkdir(root, { recursive: true, mode: 0o700 });
		let info;
		try {
			info = await lstat(root);
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return null;
			throw error;
		}
		if (!info.isDirectory() || info.isSymbolicLink()) {
			throw new AccountCreatorError('filesystem_error', 'Unsafe mailbox archive root.');
		}
		return await realpath(root);
	}

	private async safeArchivePath(root: string, id: string): Promise<string> {
		const candidate = path.resolve(root, id);
		if (!candidate.startsWith(`${root}${path.sep}`)) {
			throw new AccountCreatorError('invalid_request', 'Unsafe archive identifier.');
		}
		let info;
		try {
			info = await lstat(candidate);
		} catch (error) {
			if (errorCode(error) === 'ENOENT') {
				throw new AccountCreatorError('archive_not_found', 'The mailbox archive does not exist.');
			}
			throw error;
		}
		if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(candidate)) !== candidate) {
			throw new AccountCreatorError('invalid_request', 'Unsafe mailbox archive.');
		}
		return candidate;
	}
}

export function parseArchiveId(id: string): { address: string; deletedAt: string } | null {
	const match = ARCHIVE_PATTERN.exec(id);
	if (!match) return null;
	try {
		const address = validateAddress(match[2]);
		const raw = match[1];
		const date = new Date(
			`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}.${raw.slice(15, 18)}Z`
		);
		if (Number.isNaN(date.getTime()) || archiveDateToken(date) !== raw) return null;
		return { address, deletedAt: date.toISOString() };
	} catch {
		return null;
	}
}

function archiveDateToken(date: Date): string {
	const iso = date.toISOString();
	return `${iso.slice(0, 10).replaceAll('-', '')}T${iso.slice(11, 19).replaceAll(':', '')}${iso.slice(20, 23)}`;
}

function validateArchiveId(value: unknown): string {
	if (typeof value !== 'string' || parseArchiveId(value) === null) {
		throw new AccountCreatorError('invalid_request', 'Invalid archive identifier.');
	}
	return value;
}

function validateConfirmation(input: unknown): string {
	if (
		typeof input !== 'object' ||
		input === null ||
		!('confirmation' in input) ||
		typeof input.confirmation !== 'string'
	) {
		throw new AccountCreatorError('invalid_request', 'A confirmation address is required.');
	}
	return input.confirmation;
}

function containsAddress(contents: string, address: string): boolean {
	return contents.split(/\r?\n/).some((line) => {
		const colon = line.indexOf(':');
		return colon !== -1 && line.slice(0, colon).trim() === address;
	});
}

async function exists(target: string): Promise<boolean> {
	try {
		await lstat(target);
		return true;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;
		throw error;
	}
}

async function safeRecursiveDelete(target: string, root: string): Promise<void> {
	const info = await lstat(target);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		await unlink(target);
		return;
	}
	const resolved = await realpath(target);
	if (resolved !== target || !resolved.startsWith(`${root}${path.sep}`)) {
		throw new AccountCreatorError('invalid_request', 'Unsafe archive deletion target.');
	}
	for (const entry of await readdir(target)) {
		await safeRecursiveDelete(path.join(target, entry), root);
	}
	await rmdir(target);
}

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
