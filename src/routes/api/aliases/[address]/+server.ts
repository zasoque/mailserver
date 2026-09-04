import { json } from '@sveltejs/kit';
import type { AccountsApiError } from '$lib/mail/accounts';
import { isValidAliasAddress, type UpdateAliasRequest } from '$lib/mail/aliases';
import {
	deleteAliasWithHelper,
	MailHelperClientError,
	updateAliasWithHelper
} from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	if (!isValidAliasAddress(params.address))
		return apiError(400, 'invalid_request', 'A valid zasoque.org alias is required.');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'invalid_request', 'A valid JSON body is required.');
	}
	if (!isUpdateAliasRequest(body))
		return apiError(400, 'invalid_request', 'A destination is required.');
	try {
		return json(await updateAliasWithHelper(params.address, body));
	} catch (error) {
		return helperError(error, 'Unable to update the alias.');
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!isValidAliasAddress(params.address))
		return apiError(400, 'invalid_request', 'A valid zasoque.org alias is required.');
	try {
		return json(await deleteAliasWithHelper(params.address));
	} catch (error) {
		return helperError(error, 'Unable to delete the alias.');
	}
};

function isUpdateAliasRequest(value: unknown): value is UpdateAliasRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'destination' in value &&
		isValidAliasAddress(value.destination)
	);
}

function helperError(error: unknown, fallback: string) {
	if (error instanceof MailHelperClientError)
		return apiError(error.status, error.code, error.message);
	console.error('Unexpected alias API failure.');
	return apiError(500, 'repository_error', fallback);
}

function apiError(status: number, code: AccountsApiError['error']['code'], message: string) {
	return json({ error: { code, message } } satisfies AccountsApiError, { status });
}
