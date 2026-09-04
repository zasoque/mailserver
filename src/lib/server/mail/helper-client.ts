import { env } from '$env/dynamic/private';
import type {
	AccountsApiError,
	CreateAccountRequest,
	CreateAccountResponse
} from '$lib/mail/accounts';

export class MailHelperClientError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: AccountsApiError['error']['code'],
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'MailHelperClientError';
	}
}

export async function createAccountWithHelper(
	request: CreateAccountRequest
): Promise<CreateAccountResponse> {
	const port = helperPort(env.MAIL_HELPER_PORT);
	let response: Response;
	try {
		response = await fetch(`http://127.0.0.1:${port}/accounts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(request),
			signal: AbortSignal.timeout(15_000)
		});
	} catch (error) {
		throw new MailHelperClientError(
			503,
			'helper_unavailable',
			'The privileged mail helper is unavailable.',
			{ cause: error }
		);
	}

	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const helperError = readHelperError(body);
		throw new MailHelperClientError(response.status, helperError.code, helperError.message);
	}
	if (!isCreateAccountResponse(body)) {
		throw new MailHelperClientError(
			502,
			'creation_failed',
			'The mail helper returned an invalid response.'
		);
	}
	return body;
}

function helperPort(value: string | undefined): number {
	if (value === undefined) return 8787;
	if (!/^\d{1,5}$/.test(value)) return 8787;
	const port = Number(value);
	return port >= 1 && port <= 65535 ? port : 8787;
}

function readHelperError(value: unknown): AccountsApiError['error'] {
	if (
		typeof value === 'object' &&
		value !== null &&
		'error' in value &&
		typeof value.error === 'object' &&
		value.error !== null &&
		'code' in value.error &&
		'message' in value.error &&
		typeof value.error.code === 'string' &&
		typeof value.error.message === 'string'
	) {
		if (value.error.code === 'account_exists') {
			return { code: 'account_exists', message: value.error.message };
		}
		if (value.error.code === 'invalid_request') {
			return { code: 'invalid_request', message: value.error.message };
		}
	}
	return {
		code: 'creation_failed',
		message: 'The privileged mail helper could not create the account.'
	};
}

function isCreateAccountResponse(value: unknown): value is CreateAccountResponse {
	return (
		typeof value === 'object' &&
		value !== null &&
		'address' in value &&
		'maildir' in value &&
		'created' in value &&
		typeof value.address === 'string' &&
		typeof value.maildir === 'string' &&
		value.created === true
	);
}
