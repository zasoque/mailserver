import { json } from '@sveltejs/kit';
import type { AccountsApiError } from '$lib/mail/accounts';
import { isValidAliasAddress } from '$lib/mail/aliases';
import {
	emptyTrashWithHelper,
	getTrashStatusWithHelper,
	MailHelperClientError
} from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidAliasAddress(params.address)) return invalidAddress();
	try {
		return json(await getTrashStatusWithHelper(params.address));
	} catch (error) {
		return helperError(error);
	}
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	if (!isValidAliasAddress(params.address)) return invalidAddress();
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'invalid_request', 'A valid JSON body is required.');
	}
	if (
		typeof body !== 'object' ||
		body === null ||
		!('confirmed' in body) ||
		body.confirmed !== true
	) {
		return apiError(400, 'invalid_request', 'Empty Trash must be explicitly confirmed.');
	}
	try {
		return json(await emptyTrashWithHelper(params.address, { confirmed: true }));
	} catch (error) {
		return helperError(error);
	}
};

function invalidAddress() {
	return apiError(400, 'invalid_request', 'A valid zasoque.org account is required.');
}

function helperError(error: unknown) {
	if (error instanceof MailHelperClientError)
		return apiError(error.status, error.code, error.message);
	return apiError(500, 'repository_error', 'Could not process Trash.');
}

function apiError(status: number, code: AccountsApiError['error']['code'], message: string) {
	return json({ error: { code, message } } satisfies AccountsApiError, { status });
}
