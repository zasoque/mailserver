import { json } from '@sveltejs/kit';
import { archiveAddressFromId } from '$lib/mail/deleted';
import {
	MailHelperClientError,
	permanentlyDeleteArchiveWithHelper
} from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, request }) => {
	const archiveAddress = archiveAddressFromId(params.archiveId);
	if (archiveAddress === null)
		return failure(400, 'invalid_request', 'A valid archive identifier is required.');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return failure(400, 'invalid_request', 'A valid JSON body is required.');
	}
	if (
		typeof body !== 'object' ||
		body === null ||
		!('confirmation' in body) ||
		typeof body.confirmation !== 'string'
	)
		return failure(400, 'invalid_request', 'A confirmation address is required.');
	if (body.confirmation !== archiveAddress)
		return failure(
			400,
			'confirmation_mismatch',
			'Type the complete account address to confirm permanent deletion.'
		);
	try {
		return json(
			await permanentlyDeleteArchiveWithHelper(params.archiveId, {
				confirmation: body.confirmation
			})
		);
	} catch (error) {
		if (error instanceof MailHelperClientError)
			return failure(error.status, error.code, error.message);
		return failure(500, 'repository_error', 'Unable to permanently delete the archive.');
	}
};

function failure(status: number, code: string, message: string) {
	return json({ error: { code, message } }, { status });
}
