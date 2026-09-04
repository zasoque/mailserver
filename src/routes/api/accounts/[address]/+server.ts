import { json } from '@sveltejs/kit';
import type { AccountsApiError } from '$lib/mail/accounts';
import { deleteAccountWithHelper, MailHelperClientError } from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		return json(await deleteAccountWithHelper(params.address));
	} catch (error) {
		if (error instanceof MailHelperClientError) {
			return apiError(error.status, error.code, error.message);
		}
		console.error('Unexpected error while forwarding an account deletion request.');
		return apiError(500, 'creation_failed', 'Unable to delete the mail account.');
	}
};

function apiError(status: number, code: AccountsApiError['error']['code'], message: string) {
	return json({ error: { code, message } } satisfies AccountsApiError, { status });
}
