import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
	MailAccountRepositoryError,
	type MailAccount,
	type MailAccountRepository
} from './accounts';

const LOCAL_PART_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9])?$/;
const DOMAIN_PATTERN =
	/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export interface DovecotFileAccountRepositoryOptions {
	usersFilePath: string;
	vmailRoot: string;
}

export class DovecotFileAccountRepository implements MailAccountRepository {
	constructor(private readonly options: DovecotFileAccountRepositoryOptions) {}

	async list(): Promise<MailAccount[]> {
		const contents = await this.readUsersFile();
		const identities = parseAccountAddresses(contents);

		return Promise.all(
			identities.map(async ({ address, username, domain }) => {
				const mailHome = safeAccountPath(this.options.vmailRoot, domain, username);
				const maildirPath = path.join(mailHome, 'Maildir');

				return {
					address,
					username,
					domain,
					mailHome,
					maildirPath,
					usageBytes: await directorySize(maildirPath)
				};
			})
		);
	}

	private async readUsersFile(): Promise<string> {
		try {
			const file = await open(this.options.usersFilePath, 'r');
			try {
				return await file.readFile({ encoding: 'utf8' });
			} finally {
				await file.close();
			}
		} catch (error) {
			const code = getErrorCode(error);
			if (code === 'EACCES' || code === 'EPERM') {
				throw new MailAccountRepositoryError(
					'permission_denied',
					'The server does not have permission to read the Dovecot users file.',
					{ cause: error }
				);
			}
			if (code === 'ENOENT') {
				throw new MailAccountRepositoryError(
					'users_file_not_found',
					'The Dovecot users file was not found.',
					{ cause: error }
				);
			}

			throw new MailAccountRepositoryError('io_error', 'Failed to read the Dovecot users file.', {
				cause: error
			});
		}
	}
}

function parseAccountAddresses(contents: string) {
	const accounts: Array<{ address: string; username: string; domain: string }> = [];

	for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#')) continue;

		const separatorIndex = line.indexOf(':');
		const address = separatorIndex === -1 ? '' : line.slice(0, separatorIndex).trim();
		const atIndex = address.lastIndexOf('@');
		const username = atIndex === -1 ? '' : address.slice(0, atIndex);
		const domain = atIndex === -1 ? '' : address.slice(atIndex + 1).toLowerCase();

		if (!LOCAL_PART_PATTERN.test(username) || !DOMAIN_PATTERN.test(domain)) {
			throw new MailAccountRepositoryError(
				'invalid_users_file',
				`The Dovecot users file contains an invalid account address on line ${index + 1}.`
			);
		}

		accounts.push({ address: `${username}@${domain}`, username, domain });
	}

	return accounts.sort((a, b) => a.address.localeCompare(b.address));
}

function safeAccountPath(vmailRoot: string, domain: string, username: string): string {
	if (!DOMAIN_PATTERN.test(domain) || !LOCAL_PART_PATTERN.test(username)) {
		throw new MailAccountRepositoryError(
			'invalid_users_file',
			'Refused to construct an unsafe path.'
		);
	}

	const root = path.resolve(vmailRoot);
	const accountPath = path.resolve(root, domain, username);
	if (!accountPath.startsWith(`${root}${path.sep}`)) {
		throw new MailAccountRepositoryError(
			'invalid_users_file',
			'Refused to access a path outside vmail.'
		);
	}

	return accountPath;
}

async function directorySize(directoryPath: string): Promise<number | null> {
	let total = 0;

	try {
		for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
			const entryPath = path.join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				const nestedSize = await directorySize(entryPath);
				if (nestedSize === null) return null;
				total += nestedSize;
			} else if (entry.isFile()) {
				total += (await lstat(entryPath)).size;
			}
		}
		return total;
	} catch (error) {
		const code = getErrorCode(error);
		if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null;
		throw new MailAccountRepositoryError('io_error', 'Failed to calculate Maildir usage.', {
			cause: error
		});
	}
}

function getErrorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
