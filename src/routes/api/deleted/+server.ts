import { json } from '@sveltejs/kit';
import {
	listDeletedAccountsWithHelper,
	MailHelperClientError
} from '$lib/server/mail/helper-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await listDeletedAccountsWithHelper());
	} catch (error) {
		if (error instanceof MailHelperClientError)
			return json(
				{ error: { code: error.code, message: error.message } },
				{ status: error.status }
			);
		return json(
			{ error: { code: 'repository_error', message: 'Unable to load deleted accounts.' } },
			{ status: 500 }
		);
	}
};
