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
import type { CreateAccountRequest, CreateAccountResponse } from '../src/lib/mail/accounts';

export const ALLOWED_DOMAIN = 'zasoque.org' as const;
const USERNAME_PATTERN = /^[a-z0-9._-]{1,64}$/;
const FORBIDDEN_PASSWORD_CHARACTERS = /[\0\r\n]/;

export type AccountCreatorErrorCode =
	'invalid_request' | 'account_exists' | 'doveadm_failed' | 'filesystem_error';

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
}

export interface AccountCreatorDependencies {
	hashPassword?: (password: string) => Promise<string>;
	chownTree?: (target: string, uid: number, gid: number) => Promise<void>;
}

export class AccountCreator {
	private operationQueue: Promise<void> = Promise.resolve();
	private readonly hashPassword: (password: string) => Promise<string>;
	private readonly chownTree: (target: string, uid: number, gid: number) => Promise<void>;

	constructor(
		private readonly options: AccountCreatorOptions,
		dependencies: AccountCreatorDependencies = {}
	) {
		this.hashPassword =
			dependencies.hashPassword ??
			((password) => hashPasswordWithDoveadm(options.doveadmPath, password));
		this.chownTree = dependencies.chownTree ?? chownDirectoryTree;
	}

	create(input: unknown): Promise<CreateAccountResponse> {
		const operation = this.operationQueue.then(() =>
			this.createLocked(validateCreateRequest(input))
		);
		this.operationQueue = operation.then(
			() => undefined,
			() => undefined
		);
		return operation;
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

async function hashPasswordWithDoveadm(doveadmPath: string, password: string): Promise<string> {
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

function appendUsersEntry(contents: string, address: string, hash: string): string {
	const separator = contents === '' || contents.endsWith('\n') ? '' : '\n';
	return `${contents}${separator}${address}:${hash}\n`;
}

async function createTimestampedBackup(usersFilePath: string): Promise<string> {
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

async function atomicWrite(
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

async function chownDirectoryTree(target: string, uid: number, gid: number): Promise<void> {
	const targetStat = await lstat(target);
	if (targetStat.isSymbolicLink()) throw new Error('Refused to chown a symbolic link.');
	if (targetStat.isDirectory()) {
		for (const entry of await readdir(target)) {
			await chownDirectoryTree(path.join(target, entry), uid, gid);
		}
	}
	await chown(target, uid, gid);
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
