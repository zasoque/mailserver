import { json } from '@sveltejs/kit';
import { archiveAddressFromId } from '$lib/mail/deleted';
import {
	MailHelperClientError,
	restoreDeletedAccountWithHelper
} from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	if (archiveAddressFromId(params.archiveId) === null)
		return failure(400, 'invalid_request', 'A valid archive identifier is required.');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return failure(400, 'invalid_request', 'A valid JSON body is required.');
	}
	if (!isPasswordRequest(body))
		return failure(400, 'invalid_request', 'New password and confirmation are required.');
	if (body.password !== body.confirmPassword)
		return failure(400, 'invalid_request', 'Passwords do not match.');
	try {
		return json(await restoreDeletedAccountWithHelper(params.archiveId, body));
	} catch (error) {
		if (error instanceof MailHelperClientError)
			return failure(error.status, error.code, error.message);
		return failure(500, 'repository_error', 'Unable to restore the account.');
	}
};

function isPasswordRequest(value: unknown): value is { password: string; confirmPassword: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'password' in value &&
		'confirmPassword' in value &&
		typeof value.password === 'string' &&
		typeof value.confirmPassword === 'string'
	);
}

function failure(status: number, code: string, message: string) {
	return json({ error: { code, message } }, { status });
}
