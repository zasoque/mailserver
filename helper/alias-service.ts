import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, chown, copyFile, lstat, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
	AliasMutationResponse,
	AliasesApiResponse,
	CreateAliasRequest,
	UpdateAliasRequest,
	VirtualAlias
} from '../src/lib/mail/aliases';
import { PROTECTED_ALIAS_ADDRESSES } from '../src/lib/mail/config';
import { AccountCreatorError, atomicWrite, validateAddress } from './account-creator';
import { OperationQueue } from './operation-queue';

export interface AliasServiceOptions {
	aliasFilePath: string;
	usersFilePath: string;
	postmapPath: string;
	backupDirectoryPath: string;
}

export interface AliasServiceDependencies {
	operationQueue?: OperationQueue;
	runPostmap?: () => Promise<void>;
}

export class AliasService {
	private readonly operationQueue: OperationQueue;
	private readonly runPostmap: () => Promise<void>;

	constructor(
		private readonly options: AliasServiceOptions,
		dependencies: AliasServiceDependencies = {}
	) {
		this.operationQueue = dependencies.operationQueue ?? new OperationQueue();
		this.runPostmap =
			dependencies.runPostmap ?? (() => runPostmap(options.postmapPath, options.aliasFilePath));
	}

	async list(): Promise<AliasesApiResponse> {
		return this.operationQueue.run(async () => {
			const aliases = parseAliasSource(await this.readAliasFile()).map(
				({ address, destination }) => ({
					address,
					destination
				})
			);
			aliases.sort((first, second) => first.address.localeCompare(second.address));
			return { aliases };
		});
	}

	async verifyMutationAccess(): Promise<void> {
		await probeWritableDirectory(await validateBackupDirectory(this.options.backupDirectoryPath));
		const directory = await validateAliasDirectory(path.dirname(this.options.aliasFilePath));
		const probePath = path.join(directory, `.write-test.${randomUUID()}`);
		let probeExists = false;
		try {
			const probe = await open(probePath, 'wx', 0o600);
			probeExists = true;
			try {
				await probe.chmod(0o600);
				await probe.sync();
			} finally {
				await probe.close();
			}
		} finally {
			if (probeExists) await rm(probePath, { force: true });
		}

		const before = await validateAliasSource(this.options.aliasFilePath);
		const source = await open(this.options.aliasFilePath, 'r');
		try {
			const opened = await source.stat();
			if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) {
				throw new Error('The alias source changed while it was being opened.');
			}
		} finally {
			await source.close();
		}
	}

	private async sourceMetadata() {
		const before = await validateAliasSource(this.options.aliasFilePath);
		if (!before.isFile() || before.isSymbolicLink()) {
			throw new Error('The alias source is not a safe regular file.');
		}
		return before;
	}

	create(input: unknown): Promise<AliasMutationResponse> {
		const request = validateCreateAliasRequest(input);
		return this.operationQueue.run(() =>
			this.mutate(async (contents) => {
				const records = parseAliasSource(contents);
				if (records.some(({ address }) => address === request.address)) {
					throw new AccountCreatorError(
						'alias_exists',
						'An alias already exists with this address.'
					);
				}
				await this.validateRouting(request.address, request.destination);
				const separator = contents === '' || contents.endsWith('\n') ? '' : '\n';
				return {
					contents: `${contents}${separator}${request.address}\t${request.destination}\n`,
					response: { ...request, created: true }
				};
			})
		);
	}

	update(address: unknown, input: unknown): Promise<AliasMutationResponse> {
		const validatedAddress = validateAddress(address);
		const request = validateUpdateAliasRequest(input);
		return this.operationQueue.run(() =>
			this.mutate(async (contents) => {
				const records = parseAliasSource(contents);
				const target = singleAlias(records, validatedAddress);
				await this.validateRouting(validatedAddress, request.destination);
				return {
					contents: replaceAliasLine(
						contents,
						target.lineIndex,
						validatedAddress,
						request.destination
					),
					response: { address: validatedAddress, destination: request.destination, updated: true }
				};
			})
		);
	}

	delete(address: unknown): Promise<AliasMutationResponse> {
		const validatedAddress = validateAddress(address);
		if ((PROTECTED_ALIAS_ADDRESSES as readonly string[]).includes(validatedAddress)) {
			throw new AccountCreatorError(
				'protected_alias',
				'This alias is protected and cannot be deleted.'
			);
		}
		return this.operationQueue.run(() =>
			this.mutate(async (contents) => {
				const target = singleAlias(parseAliasSource(contents), validatedAddress);
				return {
					contents: removeAliasLine(contents, target.lineIndex),
					response: {
						address: validatedAddress,
						destination: target.destination,
						deleted: true
					}
				};
			})
		);
	}

	private async mutate(
		change: (contents: string) => Promise<{ contents: string; response: AliasMutationResponse }>
	): Promise<AliasMutationResponse> {
		const original = await this.readAliasFile();
		const changed = await change(original);
		const metadata = await this.sourceMetadata();
		try {
			await createExternalBackup(this.options.aliasFilePath, this.options.backupDirectoryPath);
		} catch (error) {
			console.error(`alias backup failure: ${safeErrorMessage(error)}`);
			throw new AccountCreatorError(
				'filesystem_error',
				'Unable to back up the virtual alias file.',
				{
					cause: error
				}
			);
		}
		let postmapStarted = false;
		try {
			await atomicWrite(
				this.options.aliasFilePath,
				changed.contents,
				metadata.mode,
				metadata.uid,
				metadata.gid
			);
			postmapStarted = true;
			await this.runPostmap();
		} catch (error) {
			console.error(
				`${postmapStarted ? 'postmap' : 'alias source update'} failure: ${safeErrorMessage(error)}`
			);
			try {
				await atomicWrite(
					this.options.aliasFilePath,
					original,
					metadata.mode,
					metadata.uid,
					metadata.gid
				);
				await this.runPostmap();
			} catch (rollbackError) {
				console.error(`alias rollback failure: ${safeErrorMessage(rollbackError)}`);
			}
			throw new AccountCreatorError(
				postmapStarted ? 'postmap_failed' : 'filesystem_error',
				postmapStarted
					? 'Postfix alias map generation failed.'
					: 'Unable to update the virtual alias file.',
				{ cause: error }
			);
		}
		return changed.response;
	}

	private async validateRouting(address: string, destination: string): Promise<void> {
		if (address === destination) {
			throw new AccountCreatorError('invalid_request', 'An alias cannot deliver to itself.');
		}
		const accounts = await readAccountAddresses(this.options.usersFilePath);
		if (accounts.has(address)) {
			throw new AccountCreatorError(
				'account_address_conflict',
				'An account already exists with this address.'
			);
		}
		if (!accounts.has(destination)) {
			throw new AccountCreatorError(
				'destination_not_found',
				'The destination account does not exist.'
			);
		}
	}

	private async readAliasFile(): Promise<string> {
		try {
			return await readFile(this.options.aliasFilePath, 'utf8');
		} catch (error) {
			throw new AccountCreatorError('filesystem_error', 'Unable to read the virtual alias file.', {
				cause: error
			});
		}
	}
}

async function createExternalBackup(
	sourcePath: string,
	backupDirectoryPath: string
): Promise<string> {
	const directory = await validateBackupDirectory(backupDirectoryPath);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = path.join(
		directory,
		`${path.basename(sourcePath)}.${timestamp}.${randomUUID()}.bak`
	);
	await copyFile(sourcePath, backupPath, constants.COPYFILE_EXCL);
	const backup = await open(backupPath, 'r+');
	try {
		await backup.chmod(0o600);
		await backup.sync();
	} finally {
		await backup.close();
	}
	const directoryHandle = await open(directory, 'r');
	try {
		await directoryHandle.sync();
	} finally {
		await directoryHandle.close();
	}
	return backupPath;
}

async function validateBackupDirectory(backupDirectoryPath: string): Promise<string> {
	const directory = path.resolve(backupDirectoryPath);
	const info = await lstat(directory);
	if (
		!info.isDirectory() ||
		info.isSymbolicLink() ||
		info.uid !== process.geteuid?.() ||
		(info.mode & 0o022) !== 0
	) {
		throw new Error('The alias backup directory is unsafe.');
	}
	return directory;
}

async function validateAliasDirectory(directoryPath: string): Promise<string> {
	const directory = path.resolve(directoryPath);
	const info = await lstat(directory);
	if (
		!info.isDirectory() ||
		info.isSymbolicLink() ||
		info.uid !== process.geteuid?.() ||
		(info.mode & 0o022) !== 0
	) {
		throw new Error('The alias source directory is unsafe.');
	}
	return directory;
}

async function validateAliasSource(sourcePath: string) {
	const info = await lstat(sourcePath);
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		info.uid !== process.geteuid?.() ||
		(info.mode & 0o077) !== 0
	) {
		throw new Error('The alias source is not a safe owner-only regular file.');
	}
	return info;
}

async function probeWritableDirectory(directory: string): Promise<void> {
	const probePath = path.join(directory, `.write-test.${randomUUID()}`);
	let exists = false;
	try {
		const file = await open(probePath, 'wx', 0o600);
		exists = true;
		try {
			await file.chmod(0o600);
			await file.sync();
		} finally {
			await file.close();
		}
	} finally {
		if (exists) await rm(probePath, { force: true });
	}
}

interface AliasRecord extends VirtualAlias {
	lineIndex: number;
}

export function parseAliasSource(contents: string): AliasRecord[] {
	const parts = contents.split(/(\r?\n)/);
	const records: AliasRecord[] = [];
	for (let lineIndex = 0; lineIndex < parts.length; lineIndex += 2) {
		const line = parts[lineIndex].trim();
		if (line === '' || line.startsWith('#')) continue;
		const fields = line.split(/\s+/);
		if (fields.length !== 2) {
			throw new AccountCreatorError('filesystem_error', 'The virtual alias file is invalid.');
		}
		records.push({
			address: validateAddress(fields[0]),
			destination: validateAddress(fields[1]),
			lineIndex
		});
	}
	return records;
}

function validateCreateAliasRequest(input: unknown): CreateAliasRequest {
	if (!isRecord(input))
		throw new AccountCreatorError('invalid_request', 'A JSON object is required.');
	return {
		address: validateAddress(input.address),
		destination: validateAddress(input.destination)
	};
}

function validateUpdateAliasRequest(input: unknown): UpdateAliasRequest {
	if (!isRecord(input))
		throw new AccountCreatorError('invalid_request', 'A JSON object is required.');
	return { destination: validateAddress(input.destination) };
}

function singleAlias(records: AliasRecord[], address: string): AliasRecord {
	const matches = records.filter((record) => record.address === address);
	if (matches.length === 0)
		throw new AccountCreatorError('alias_not_found', 'The alias does not exist.');
	if (matches.length !== 1)
		throw new AccountCreatorError(
			'filesystem_error',
			'The virtual alias file contains duplicate aliases.'
		);
	return matches[0];
}

function replaceAliasLine(
	contents: string,
	lineIndex: number,
	address: string,
	destination: string
): string {
	const parts = contents.split(/(\r?\n)/);
	parts[lineIndex] = `${address}\t${destination}`;
	return parts.join('');
}

function removeAliasLine(contents: string, lineIndex: number): string {
	const parts = contents.split(/(\r?\n)/);
	parts[lineIndex] = '';
	if (lineIndex + 1 < parts.length) parts[lineIndex + 1] = '';
	return parts.join('');
}

async function readAccountAddresses(usersFilePath: string): Promise<Set<string>> {
	const contents = await readFile(usersFilePath, 'utf8');
	const addresses = new Set<string>();
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;
		const separator = line.indexOf(':');
		addresses.add(validateAddress(separator === -1 ? '' : line.slice(0, separator).trim()));
	}
	return addresses;
}

async function runPostmap(postmapPath: string, aliasFilePath: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(postmapPath, [aliasFilePath], {
			shell: false,
			stdio: ['ignore', 'ignore', 'pipe'],
			env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }
		});
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			if (stderr.length < 8192) stderr += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`postmap exited with code ${code}: ${stderr.trim()}`));
		});
	});
	const directory = await stat(path.dirname(aliasFilePath));
	const databasePath = `${aliasFilePath}.db`;
	await chown(databasePath, 0, directory.gid);
	await chmod(databasePath, 0o640);
}

function safeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 2048) : 'unknown error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
