import { spawn } from 'node:child_process';
import {
	chown,
	copyFile,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat
} from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
	ChangePasswordRequest,
	ChangePasswordResponse,
	CreateAccountRequest,
	CreateAccountResponse,
	DeleteAccountResponse
} from '../src/lib/mail/accounts';
import { PROTECTED_ACCOUNT_ADDRESSES } from '../src/lib/mail/config';
import { OperationQueue } from './operation-queue';

export const ALLOWED_DOMAIN = 'zasoque.org' as const;
const USERNAME_PATTERN = /^[a-z0-9._-]{1,64}$/;
const FORBIDDEN_PASSWORD_CHARACTERS = /[\0\r\n]/;

export type AccountCreatorErrorCode =
	| 'invalid_request'
	| 'account_exists'
	| 'account_not_found'
	| 'protected_account'
	| 'alias_in_use'
	| 'alias_exists'
	| 'alias_not_found'
	| 'account_address_conflict'
	| 'destination_not_found'
	| 'protected_alias'
	| 'postmap_failed'
	| 'archive_not_found'
	| 'archive_conflict'
	| 'confirmation_mismatch'
	| 'trash_operation_failed'
	| 'doveadm_failed'
	| 'filesystem_error';

export class AccountCreatorError extends Error {
	constructor(
		public readonly code: AccountCreatorErrorCode,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'AccountCreatorError';
	}
}

export interface AccountCreatorOptions {
	usersFilePath: string;
	vmailRoot: string;
	doveadmPath: string;
	uid: number;
	gid: number;
	virtualAliasFilePath?: string;
}

export interface AccountCreatorDependencies {
	hashPassword?: (password: string) => Promise<string>;
	chownTree?: (target: string, uid: number, gid: number) => Promise<void>;
	moveMailbox?: (source: string, destination: string) => Promise<void>;
	operationQueue?: OperationQueue;
}

export class AccountCreator {
	private readonly operationQueue: OperationQueue;
	private readonly hashPassword: (password: string) => Promise<string>;
	private readonly chownTree: (target: string, uid: number, gid: number) => Promise<void>;
	private readonly moveMailbox: (source: string, destination: string) => Promise<void>;

	constructor(
		private readonly options: AccountCreatorOptions,
		dependencies: AccountCreatorDependencies = {}
	) {
		this.hashPassword =
			dependencies.hashPassword ??
			((password) => hashPasswordWithDoveadm(options.doveadmPath, password));
		this.chownTree = dependencies.chownTree ?? chownDirectoryTree;
		this.moveMailbox = dependencies.moveMailbox ?? rename;
		this.operationQueue = dependencies.operationQueue ?? new OperationQueue();
	}

	create(input: unknown): Promise<CreateAccountResponse> {
		return this.operationQueue.run(() => this.createLocked(validateCreateRequest(input)));
	}

	changePassword(address: unknown, input: unknown): Promise<ChangePasswordResponse> {
		return this.operationQueue.run(() =>
			this.changePasswordLocked(validateAddress(address), validateChangePasswordRequest(input))
		);
	}

	delete(address: unknown): Promise<DeleteAccountResponse> {
		return this.operationQueue.run(() => this.deleteLocked(validateAddress(address)));
	}

	private async createLocked(request: CreateAccountRequest): Promise<CreateAccountResponse> {
		const address = `${request.username}@${ALLOWED_DOMAIN}`;
		const mailHome = safeMailHome(this.options.vmailRoot, request.username);
		const maildir = path.join(mailHome, 'Maildir');
		let originalUsersContents: string;
		let usersFileChanged = false;
		let mailHomeCreated = false;

		try {
			originalUsersContents = await readFile(this.options.usersFilePath, 'utf8');
			if (containsAddress(originalUsersContents, address) || (await pathExists(mailHome))) {
				throw new AccountCreatorError('account_exists', 'The mail account already exists.');
			}
			if (
				this.options.virtualAliasFilePath &&
				(await aliasAddressExists(this.options.virtualAliasFilePath, address))
			) {
				throw new AccountCreatorError(
					'account_address_conflict',
					'An alias already exists with this address.'
				);
			}

			const passwordHash = await this.hashPassword(request.password);
			const usersStat = await stat(this.options.usersFilePath);
			await createTimestampedBackup(this.options.usersFilePath);
			usersFileChanged = true;
			await atomicWrite(
				this.options.usersFilePath,
				appendUsersEntry(originalUsersContents, address, passwordHash),
				usersStat.mode,
				usersStat.uid,
				usersStat.gid
			);

			mailHomeCreated = true;
			await mkdir(path.join(maildir, 'cur'), { recursive: true, mode: 0o700 });
			await Promise.all([
				mkdir(path.join(maildir, 'new'), { recursive: true, mode: 0o700 }),
				mkdir(path.join(maildir, 'tmp'), { recursive: true, mode: 0o700 })
			]);
			await this.chownTree(mailHome, this.options.uid, this.options.gid);

			return { address, maildir, created: true };
		} catch (error) {
			if (error instanceof AccountCreatorError && error.code === 'account_exists') throw error;

			const rollbackFailures: unknown[] = [];
			if (mailHomeCreated) {
				try {
					await rm(mailHome, { recursive: true, force: true });
				} catch (rollbackError) {
					rollbackFailures.push(rollbackError);
				}
			}
			if (usersFileChanged) {
				try {
					const usersStat = await stat(this.options.usersFilePath);
					await atomicWrite(
						this.options.usersFilePath,
						originalUsersContents!,
						usersStat.mode,
						usersStat.uid,
						usersStat.gid
					);
				} catch (rollbackError) {
					rollbackFailures.push(rollbackError);
				}
			}

			if (rollbackFailures.length > 0) {
				console.error('Account creation rollback was incomplete. Manual recovery is required.');
			}
			if (error instanceof AccountCreatorError) throw error;
			throw new AccountCreatorError('filesystem_error', 'Account creation failed.', {
				cause: error
			});
		}
	}

	private async changePasswordLocked(
		address: string,
		request: ChangePasswordRequest
	): Promise<ChangePasswordResponse> {
		try {
			const originalUsersContents = await readFile(this.options.usersFilePath, 'utf8');
			if (!containsAddress(originalUsersContents, address)) {
				throw new AccountCreatorError('account_not_found', 'The mail account does not exist.');
			}
			const updatedUsersContents = replacePasswordHash(
				originalUsersContents,
				address,
				await this.hashPassword(request.password)
			);
			const usersStat = await stat(this.options.usersFilePath);
			await createTimestampedBackup(this.options.usersFilePath);
			await atomicWrite(
				this.options.usersFilePath,
				updatedUsersContents,
				usersStat.mode,
				usersStat.uid,
				usersStat.gid
			);
			return { address, passwordChanged: true };
		} catch (error) {
			if (error instanceof AccountCreatorError) throw error;
			throw new AccountCreatorError('filesystem_error', 'Password change failed.', {
				cause: error
			});
		}
	}

	private async deleteLocked(address: string): Promise<DeleteAccountResponse> {
		if ((PROTECTED_ACCOUNT_ADDRESSES as readonly string[]).includes(address)) {
			throw new AccountCreatorError(
				'protected_account',
				'This account is protected and cannot be deleted.'
			);
		}

		const username = address.slice(0, address.indexOf('@'));
		const mailHome = safeMailHome(this.options.vmailRoot, username);
		const archiveRoot = path.resolve(this.options.vmailRoot, '.deleted');
		let originalUsersContents: string;
		let usersFileChanged = false;

		try {
			originalUsersContents = await readFile(this.options.usersFilePath, 'utf8');
			const updatedUsersContents = removeAccountLine(originalUsersContents, address);
			if (this.options.virtualAliasFilePath) {
				const aliasCount = await countAliasesForDestination(
					this.options.virtualAliasFilePath,
					address
				);
				if (aliasCount > 0) {
					throw new AccountCreatorError(
						'alias_in_use',
						`This account is used by ${aliasCount} alias${aliasCount === 1 ? '' : 'es'}. Remove or redirect its aliases before deleting the account.`
					);
				}
			}
			const mailboxExists = await pathExists(mailHome);
			let archivePath: string | null = null;
			if (mailboxExists) {
				await assertDirectoryIsNotSymlink(mailHome, 'mail home');
				await ensureArchiveRoot(archiveRoot);
				archivePath = path.join(archiveRoot, `${archiveTimestamp()}-${address}`);
				if (await pathExists(archivePath)) {
					throw new AccountCreatorError(
						'filesystem_error',
						'The mailbox archive target already exists.'
					);
				}
			}

			const usersStat = await stat(this.options.usersFilePath);
			await createTimestampedBackup(this.options.usersFilePath);
			usersFileChanged = true;
			await atomicWrite(
				this.options.usersFilePath,
				updatedUsersContents,
				usersStat.mode,
				usersStat.uid,
				usersStat.gid
			);

			if (archivePath !== null) await this.moveMailbox(mailHome, archivePath);
			return { address, deleted: true, mailboxArchived: archivePath !== null };
		} catch (error) {
			if (usersFileChanged) {
				try {
					const usersStat = await stat(this.options.usersFilePath);
					await atomicWrite(
						this.options.usersFilePath,
						originalUsersContents!,
						usersStat.mode,
						usersStat.uid,
						usersStat.gid
					);
				} catch {
					console.error('Account deletion rollback was incomplete. Manual recovery is required.');
				}
			}
			if (error instanceof AccountCreatorError) throw error;
			throw new AccountCreatorError('filesystem_error', 'Account deletion failed.', {
				cause: error
			});
		}
	}
}

export function validateCreateRequest(input: unknown): CreateAccountRequest {
	if (!isRecord(input))
		throw new AccountCreatorError('invalid_request', 'A JSON object is required.');
	const { username, domain, password } = input;
	if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
		throw new AccountCreatorError(
			'invalid_request',
			'Username must be 1–64 lowercase ASCII letters, digits, dots, underscores, or hyphens.'
		);
	}
	if (domain !== ALLOWED_DOMAIN) {
		throw new AccountCreatorError('invalid_request', `Domain must be ${ALLOWED_DOMAIN}.`);
	}
	if (
		typeof password !== 'string' ||
		password.length < 1 ||
		password.length > 1024 ||
		FORBIDDEN_PASSWORD_CHARACTERS.test(password)
	) {
		throw new AccountCreatorError(
			'invalid_request',
			'Password must be 1–1024 characters and cannot contain NUL or line breaks.'
		);
	}
	return { username, domain, password };
}

export function validateAddress(input: unknown): string {
	if (typeof input !== 'string') {
		throw new AccountCreatorError('invalid_request', 'A valid account address is required.');
	}
	const suffix = `@${ALLOWED_DOMAIN}`;
	if (!input.endsWith(suffix)) {
		throw new AccountCreatorError(
			'invalid_request',
			`Only ${ALLOWED_DOMAIN} accounts are allowed.`
		);
	}
	const username = input.slice(0, -suffix.length);
	if (!USERNAME_PATTERN.test(username) || input !== `${username}${suffix}`) {
		throw new AccountCreatorError('invalid_request', 'The account address is invalid.');
	}
	return input;
}

export function validateChangePasswordRequest(input: unknown): ChangePasswordRequest {
	if (!isRecord(input)) {
		throw new AccountCreatorError('invalid_request', 'A JSON object is required.');
	}
	const { password, confirmPassword } = input;
	validatePassword(password);
	if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
		throw new AccountCreatorError('invalid_request', 'Passwords do not match.');
	}
	return { password, confirmPassword };
}

export async function hashPasswordWithDoveadm(
	doveadmPath: string,
	password: string
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(doveadmPath, ['pw', '-s', 'BLF-CRYPT'], {
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: false,
			env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			if (stdout.length < 8192) stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			if (stderr.length < 8192) stderr += chunk;
		});
		child.once('error', (error) =>
			reject(
				new AccountCreatorError('doveadm_failed', 'Unable to start doveadm.', { cause: error })
			)
		);
		child.once('close', (code) => {
			if (code !== 0) {
				reject(new AccountCreatorError('doveadm_failed', 'doveadm password hashing failed.'));
				return;
			}
			const hash = stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find((line) => /^\{BLF-CRYPT\}\$2[aby]\$/.test(line));
			if (!hash || stderr.toLowerCase().includes('error')) {
				reject(new AccountCreatorError('doveadm_failed', 'doveadm returned an invalid hash.'));
				return;
			}
			resolve(hash);
		});
		child.stdin.end(`${password}\n${password}\n`);
	});
}

function safeMailHome(vmailRoot: string, username: string): string {
	if (!USERNAME_PATTERN.test(username)) {
		throw new AccountCreatorError('invalid_request', 'Refused to construct an unsafe mail path.');
	}
	const domainRoot = path.resolve(vmailRoot, ALLOWED_DOMAIN);
	const mailHome = path.resolve(domainRoot, username);
	if (!mailHome.startsWith(`${domainRoot}${path.sep}`)) {
		throw new AccountCreatorError('invalid_request', 'Refused to access a path outside vmail.');
	}
	return mailHome;
}

function containsAddress(contents: string, address: string): boolean {
	return contents
		.split(/\r?\n/)
		.some((line) => line.slice(0, line.indexOf(':')).trim() === address);
}

export function appendUsersEntry(contents: string, address: string, hash: string): string {
	const separator = contents === '' || contents.endsWith('\n') ? '' : '\n';
	return `${contents}${separator}${address}:${hash}\n`;
}

function replacePasswordHash(contents: string, address: string, passwordHash: string): string {
	const parts = contents.split(/(\r?\n)/);
	let matches = 0;
	const updated = parts.map((part, index) => {
		if (index % 2 === 1) return part;
		const firstColon = part.indexOf(':');
		if (firstColon === -1 || part.slice(0, firstColon).trim() !== address) return part;
		matches += 1;
		const passwordEnd = part.indexOf(':', firstColon + 1);
		const suffix = passwordEnd === -1 ? '' : part.slice(passwordEnd);
		return `${part.slice(0, firstColon + 1)}${passwordHash}${suffix}`;
	});

	if (matches === 0) {
		throw new AccountCreatorError('account_not_found', 'The mail account does not exist.');
	}
	if (matches !== 1) {
		throw new AccountCreatorError(
			'filesystem_error',
			'The users file contains duplicate accounts.'
		);
	}
	return updated.join('');
}

function removeAccountLine(contents: string, address: string): string {
	const parts = contents.split(/(\r?\n)/);
	const matchingIndexes: number[] = [];
	for (let index = 0; index < parts.length; index += 2) {
		const firstColon = parts[index].indexOf(':');
		if (firstColon !== -1 && parts[index].slice(0, firstColon).trim() === address) {
			matchingIndexes.push(index);
		}
	}
	if (matchingIndexes.length === 0) {
		throw new AccountCreatorError('account_not_found', 'The mail account does not exist.');
	}
	if (matchingIndexes.length !== 1) {
		throw new AccountCreatorError(
			'filesystem_error',
			'The users file contains duplicate accounts.'
		);
	}

	const lineIndex = matchingIndexes[0];
	parts[lineIndex] = '';
	if (lineIndex + 1 < parts.length) parts[lineIndex + 1] = '';
	return parts.join('');
}

async function countAliasesForDestination(
	aliasFilePath: string,
	destination: string
): Promise<number> {
	const contents = await readFile(aliasFilePath, 'utf8');
	let count = 0;
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const fields = line.split(/\s+/);
		if (fields.length !== 2) {
			throw new AccountCreatorError('filesystem_error', 'The virtual alias file is invalid.');
		}
		validateAddress(fields[0]);
		if (validateAddress(fields[1]) === destination) count += 1;
	}
	return count;
}

async function aliasAddressExists(aliasFilePath: string, address: string): Promise<boolean> {
	const contents = await readFile(aliasFilePath, 'utf8');
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const fields = line.split(/\s+/);
		if (fields.length !== 2) {
			throw new AccountCreatorError('filesystem_error', 'The virtual alias file is invalid.');
		}
		if (validateAddress(fields[0]) === address) return true;
		validateAddress(fields[1]);
	}
	return false;
}

function validatePassword(password: unknown): asserts password is string {
	if (
		typeof password !== 'string' ||
		password.length < 1 ||
		password.length > 1024 ||
		FORBIDDEN_PASSWORD_CHARACTERS.test(password)
	) {
		throw new AccountCreatorError(
			'invalid_request',
			'Password must be 1–1024 characters and cannot contain NUL or line breaks.'
		);
	}
}

export async function createTimestampedBackup(usersFilePath: string): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = `${usersFilePath}.${timestamp}.${randomUUID()}.bak`;
	await copyFile(usersFilePath, backupPath, constants.COPYFILE_EXCL);
	const backup = await open(backupPath, 'r');
	try {
		await backup.sync();
	} finally {
		await backup.close();
	}
	return backupPath;
}

export async function atomicWrite(
	targetPath: string,
	contents: string,
	mode: number,
	uid: number,
	gid: number
): Promise<void> {
	const directory = path.dirname(targetPath);
	const tempPath = path.join(directory, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
	let tempExists = false;
	try {
		const file = await open(tempPath, 'wx', mode & 0o7777);
		tempExists = true;
		try {
			await file.writeFile(contents, { encoding: 'utf8' });
			await file.chown(uid, gid);
			await file.chmod(mode & 0o7777);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(tempPath, targetPath);
		tempExists = false;
		const directoryHandle = await open(directory, 'r');
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
	} finally {
		if (tempExists) await rm(tempPath, { force: true });
	}
}

export async function chownDirectoryTree(target: string, uid: number, gid: number): Promise<void> {
	const targetStat = await lstat(target);
	if (targetStat.isSymbolicLink()) throw new Error('Refused to chown a symbolic link.');
	if (targetStat.isDirectory()) {
		for (const entry of await readdir(target)) {
			await chownDirectoryTree(path.join(target, entry), uid, gid);
		}
	}
	await chown(target, uid, gid);
}

async function assertDirectoryIsNotSymlink(target: string, label: string): Promise<void> {
	const targetStat = await lstat(target);
	if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
		throw new AccountCreatorError('filesystem_error', `The ${label} is not a safe directory.`);
	}
}

async function ensureArchiveRoot(archiveRoot: string): Promise<void> {
	try {
		await mkdir(archiveRoot, { mode: 0o700 });
	} catch (error) {
		if (getErrorCode(error) !== 'EEXIST') throw error;
	}
	await assertDirectoryIsNotSymlink(archiveRoot, 'mailbox archive root');
}

function archiveTimestamp(date = new Date()): string {
	const iso = date.toISOString();
	return `${iso.slice(0, 10).replaceAll('-', '')}T${iso.slice(11, 19).replaceAll(':', '')}${iso.slice(20, 23)}`;
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await lstat(target);
		return true;
	} catch (error) {
		if (getErrorCode(error) === 'ENOENT') return false;
		throw error;
	}
}

function getErrorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
