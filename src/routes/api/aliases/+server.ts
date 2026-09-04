import { json } from '@sveltejs/kit';
import type { AccountsApiError } from '$lib/mail/accounts';
import { isValidAliasAddress, type CreateAliasRequest } from '$lib/mail/aliases';
import {
	createAliasWithHelper,
	listAliasesWithHelper,
	MailHelperClientError
} from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await listAliasesWithHelper());
	} catch (error) {
		return helperError(error, 'Unable to load aliases.');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError(400, 'invalid_request', 'A valid JSON body is required.');
	}
	if (!isCreateAliasRequest(body))
		return apiError(400, 'invalid_request', 'Alias and destination are required.');
	try {
		return json(await createAliasWithHelper(body), { status: 201 });
	} catch (error) {
		return helperError(error, 'Unable to create the alias.');
	}
};

function isCreateAliasRequest(value: unknown): value is CreateAliasRequest {
	return (
		typeof value === 'object' &&
		value !== null &&
		'address' in value &&
		'destination' in value &&
		isValidAliasAddress(value.address) &&
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
