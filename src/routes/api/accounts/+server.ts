import { json } from '@sveltejs/kit';
import type { AccountsApiError, AccountsApiResponse } from '$lib/mail/accounts';
import type { CreateAccountRequest } from '$lib/mail/accounts';
import {
	MailAccountRepositoryError,
	type MailAccountRepositoryErrorCode
} from '$lib/server/mail/accounts';
import { mailAccountRepository } from '$lib/server/mail/repository';
import { createAccountWithHelper, MailHelperClientError } from '$lib/server/mail/helper-client';
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

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{
				error: { code: 'invalid_request', message: 'A valid JSON body is required.' }
			} satisfies AccountsApiError,
			{ status: 400 }
		);
	}

	if (!isCreateAccountRequest(body)) {
		return json(
			{
				error: {
					code: 'invalid_request',
					message: 'Username, the zasoque.org domain, and a password are required.'
				}
			} satisfies AccountsApiError,
			{ status: 400 }
		);
	}

	try {
		return json(await createAccountWithHelper(body), { status: 201 });
	} catch (error) {
		if (error instanceof MailHelperClientError) {
			return json(
				{ error: { code: error.code, message: error.message } } satisfies AccountsApiError,
				{ status: error.status }
			);
		}
		console.error('Unexpected error while forwarding account creation request.');
		return json(
			{
				error: { code: 'creation_failed', message: 'Unable to create the mail account.' }
			} satisfies AccountsApiError,
			{ status: 500 }
		);
	}
};

function isCreateAccountRequest(value: unknown): value is CreateAccountRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'username' in value &&
		'domain' in value &&
		'password' in value &&
		typeof value.username === 'string' &&
		value.domain === 'zasoque.org' &&
		typeof value.password === 'string'
	);
}

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
