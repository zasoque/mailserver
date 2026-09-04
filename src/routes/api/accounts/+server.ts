import { json } from '@sveltejs/kit';
import type { AccountsApiError, AccountsApiResponse } from '$lib/mail/accounts';
import {
	MailAccountRepositoryError,
	type MailAccountRepositoryErrorCode
} from '$lib/server/mail/accounts';
import { mailAccountRepository } from '$lib/server/mail/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const accounts = await mailAccountRepository.list();
		const body: AccountsApiResponse = {
			accounts: accounts.map(({ address, usageBytes }) => ({ address, usageBytes }))
		};
		return json(body);
	} catch (error) {
		if (error instanceof MailAccountRepositoryError) {
			const publicError = toPublicError(error.code);
			return json({ error: publicError } satisfies AccountsApiError, {
				status: publicError.code === 'permission_denied' ? 403 : 500
			});
		}

		console.error('Unexpected error while listing mail accounts', error);
		return json(
			{
				error: { code: 'repository_error', message: 'Unable to load mail accounts.' }
			} satisfies AccountsApiError,
			{ status: 500 }
		);
	}
};

function toPublicError(code: MailAccountRepositoryErrorCode): AccountsApiError['error'] {
	if (code === 'permission_denied') {
		return {
			code,
			message:
				'The application cannot read the Dovecot users file. Check the server file permissions.'
		};
	}
	if (code === 'users_file_not_found') {
		return { code, message: 'The configured Dovecot users file was not found.' };
	}
	return { code: 'repository_error', message: 'Unable to read the mail account repository.' };
}
