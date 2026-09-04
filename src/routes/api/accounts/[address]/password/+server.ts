import { json } from '@sveltejs/kit';
import type { AccountsApiError, ChangePasswordRequest } from '$lib/mail/accounts';
import { changePasswordWithHelper, MailHelperClientError } from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'invalid_request', 'A valid JSON body is required.');
	}
	if (!isChangePasswordRequest(body)) {
		return apiError(400, 'invalid_request', 'Password and password confirmation are required.');
	}

	try {
		return json(await changePasswordWithHelper(params.address, body));
	} catch (error) {
		if (error instanceof MailHelperClientError) {
			return apiError(error.status, error.code, error.message);
		}
		console.error('Unexpected error while forwarding a password change request.');
		return apiError(500, 'creation_failed', 'Unable to change the account password.');
	}
};

function isChangePasswordRequest(value: unknown): value is ChangePasswordRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'password' in value &&
		'confirmPassword' in value &&
		typeof value.password === 'string' &&
		typeof value.confirmPassword === 'string'
	);
}

function apiError(status: number, code: AccountsApiError['error']['code'], message: string) {
	return json({ error: { code, message } } satisfies AccountsApiError, { status });
}
