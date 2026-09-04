export interface MailAccount {
	address: string;
	username: string;
	domain: string;
	mailHome: string;
	maildirPath: string;
	usageBytes: number | null;
}

/**
 * Read-only port for mail account data.
 *
 * Keeping this interface independent from Dovecot and the filesystem allows a
 * privileged helper implementation to replace the local implementation later.
 */
export interface MailAccountRepository {
	list(): Promise<MailAccount[]>;
}

export type MailAccountRepositoryErrorCode =
	'permission_denied' | 'users_file_not_found' | 'invalid_users_file' | 'io_error';

export class MailAccountRepositoryError extends Error {
	constructor(
		public readonly code: MailAccountRepositoryErrorCode,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'MailAccountRepositoryError';
	}
}
