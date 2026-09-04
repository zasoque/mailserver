import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, chown, copyFile, lstat, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AccountCreatorError, atomicWrite, validateAddress } from './account-creator';
import { parseAliasSource } from './alias-service';

export interface SenderLoginServiceOptions {
	usersFilePath: string;
	aliasFilePath: string;
	senderLoginFilePath: string;
	backupDirectoryPath: string;
	postmapPath: string;
}

export interface SenderLoginServiceDependencies {
	runPostmap?: () => Promise<void>;
}

export class SenderLoginService {
	private readonly runPostmap: () => Promise<void>;

	constructor(
		private readonly options: SenderLoginServiceOptions,
		dependencies: SenderLoginServiceDependencies = {}
	) {
		this.runPostmap =
			dependencies.runPostmap ??
			(() => runPostmap(options.postmapPath, options.senderLoginFilePath));
	}

	async verifyMutationAccess(): Promise<void> {
		const before = await validateManagedSource(this.options.senderLoginFilePath);
		const source = await open(this.options.senderLoginFilePath, 'r');
		try {
			const opened = await source.stat();
			if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) {
				throw new Error('The sender-login source changed while it was being opened.');
			}
		} finally {
			await source.close();
		}
		await probeDirectory(path.dirname(this.options.senderLoginFilePath), false);
		await probeDirectory(this.options.backupDirectoryPath, true);
		const database = await lstat(`${this.options.senderLoginFilePath}.db`);
		const directory = await stat(path.dirname(this.options.senderLoginFilePath));
		if (
			!database.isFile() ||
			database.isSymbolicLink() ||
			database.uid !== process.geteuid?.() ||
			database.gid !== directory.gid ||
			(database.mode & 0o777) !== 0o640 ||
			before.gid !== directory.gid ||
			(before.mode & 0o777) !== 0o640
		) {
			throw new Error('The sender-login database has unsafe ownership or permissions.');
		}
	}

	async rebuildFromSources(): Promise<void> {
		const original = await readFile(this.options.senderLoginFilePath, 'utf8');
		const metadata = await validateManagedSource(this.options.senderLoginFilePath);
		const generated = await generateSenderLoginSource(
			this.options.usersFilePath,
			this.options.aliasFilePath
		);
		if (generated === original) {
			try {
				await lstat(`${this.options.senderLoginFilePath}.db`);
			} catch {
				await this.runPostmap();
			}
			return;
		}
		await createBackup(this.options.senderLoginFilePath, this.options.backupDirectoryPath);
		try {
			await atomicWrite(
				this.options.senderLoginFilePath,
				generated,
				metadata.mode,
				metadata.uid,
				metadata.gid
			);
			await this.runPostmap();
		} catch (error) {
			try {
				await atomicWrite(
					this.options.senderLoginFilePath,
					original,
					metadata.mode,
					metadata.uid,
					metadata.gid
				);
				await this.runPostmap();
			} catch {
				console.error('Sender-login rollback was incomplete. Manual recovery is required.');
			}
			throw new AccountCreatorError(
				'postmap_failed',
				'Sender authorization map generation failed.',
				{ cause: error }
			);
		}
	}
}

export async function generateSenderLoginSource(
	usersPath: string,
	aliasesPath: string
): Promise<string> {
	const accounts = new Set<string>();
	for (const raw of (await readFile(usersPath, 'utf8')).split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const separator = line.indexOf(':');
		accounts.add(validateAddress(separator < 0 ? '' : line.slice(0, separator).trim()));
	}
	const ownership = new Map<string, string>();
	for (const account of accounts) ownership.set(account, account);
	for (const alias of parseAliasSource(await readFile(aliasesPath, 'utf8'))) {
		if (!accounts.has(alias.destination))
			throw new Error('An alias destination is not an active account.');
		ownership.set(alias.address, alias.destination);
	}
	return [...ownership]
		.sort(([first], [second]) => first.localeCompare(second))
		.map(([sender, login]) => `${sender}\t${login}\n`)
		.join('');
}

async function validateManagedSource(sourcePath: string) {
	const info = await lstat(sourcePath);
	const directory = await stat(path.dirname(sourcePath));
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		info.uid !== process.geteuid?.() ||
		info.gid !== directory.gid ||
		(info.mode & 0o777) !== 0o640
	) {
		throw new Error('The sender-login source is not a safe group-readable regular file.');
	}
	return info;
}

async function probeDirectory(directoryPath: string, ownerOnly: boolean): Promise<void> {
	const directory = path.resolve(directoryPath);
	const info = await lstat(directory);
	if (
		!info.isDirectory() ||
		info.isSymbolicLink() ||
		info.uid !== process.geteuid?.() ||
		(info.mode & 0o022) !== 0 ||
		(ownerOnly && (info.mode & 0o077) !== 0)
	) {
		throw new Error('A sender-login directory is unsafe.');
	}
	const probePath = path.join(directory, `.write-test.${randomUUID()}`);
	let exists = false;
	try {
		const probe = await open(probePath, 'wx', 0o600);
		exists = true;
		try {
			await probe.chmod(0o600);
			await probe.sync();
		} finally {
			await probe.close();
		}
	} finally {
		if (exists) await rm(probePath, { force: true });
	}
}

async function createBackup(source: string, backupDirectory: string): Promise<void> {
	await probeDirectory(backupDirectory, true);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const destination = path.join(
		backupDirectory,
		`${path.basename(source)}.${timestamp}.${randomUUID()}.bak`
	);
	await copyFile(source, destination, constants.COPYFILE_EXCL);
	const file = await open(destination, 'r+');
	try {
		await file.chmod(0o600);
		await file.sync();
	} finally {
		await file.close();
	}
}

async function runPostmap(postmapPath: string, sourcePath: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(postmapPath, [sourcePath], {
			shell: false,
			stdio: ['ignore', 'ignore', 'pipe'],
			env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
		});
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			if (stderr.length < 8192) stderr += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) =>
			code === 0
				? resolve()
				: reject(new Error(`postmap exited with code ${code}: ${stderr.trim()}`))
		);
	});
	const directory = await stat(path.dirname(sourcePath));
	await chown(`${sourcePath}.db`, 0, directory.gid);
	await chmod(`${sourcePath}.db`, 0o640);
}
