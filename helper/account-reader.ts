import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AccountsApiResponse, MailAccountSummary } from '../src/lib/mail/accounts';
import { ALLOWED_DOMAIN, AccountCreatorError, validateAddress } from './account-creator';

export class AccountReader {
	constructor(
		private readonly usersFilePath: string,
		private readonly vmailRoot: string
	) {}

	async list(): Promise<AccountsApiResponse> {
		let contents: string;
		try {
			contents = await readFile(this.usersFilePath, 'utf8');
		} catch (error) {
			throw new AccountCreatorError('filesystem_error', 'Unable to read the users file.', {
				cause: error
			});
		}

		const addresses = contents
			.split(/\r?\n/)
			.filter((line) => line !== '' && !line.trimStart().startsWith('#'))
			.map((line) => {
				const separator = line.indexOf(':');
				const address = separator === -1 ? '' : line.slice(0, separator).trim();
				return validateAddress(address);
			});

		const accounts: MailAccountSummary[] = await Promise.all(
			addresses.map(async (address) => {
				const username = address.slice(0, -`@${ALLOWED_DOMAIN}`.length);
				const maildir = path.join(this.vmailRoot, ALLOWED_DOMAIN, username, 'Maildir');
				return { address, usageBytes: await directorySize(maildir) };
			})
		);
		accounts.sort((first, second) => first.address.localeCompare(second.address));
		return { accounts };
	}
}

async function directorySize(directoryPath: string): Promise<number | null> {
	let total = 0;
	try {
		for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
			const entryPath = path.join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				const nested = await directorySize(entryPath);
				if (nested === null) return null;
				total += nested;
			} else if (entry.isFile()) {
				total += (await lstat(entryPath)).size;
			}
		}
		return total;
	} catch (error) {
		const code = getErrorCode(error);
		if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') return null;
		throw new AccountCreatorError('filesystem_error', 'Unable to calculate Maildir usage.', {
			cause: error
		});
	}
}

function getErrorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
