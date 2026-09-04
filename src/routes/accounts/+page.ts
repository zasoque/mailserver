import type { AccountsApiError, AccountsApiResponse } from '$lib/mail/accounts';
import type { PageLoad } from './$types';

const ADDRESS_PATTERN = /^[a-z0-9._-]{1,64}@zasoque\.org$/;

export const load: PageLoad = async ({ fetch, url }) => {
	const response = await fetch('/api/accounts');
	if (!response.ok) {
		const body = (await response.json()) as AccountsApiError;
		return { accounts: [], loadError: body.error };
	}

	const body = (await response.json()) as AccountsApiResponse;
	const deleted = url.searchParams.get('deleted');
	return {
		accounts: body.accounts,
		loadError: null,
		deletedAccount: deleted !== null && ADDRESS_PATTERN.test(deleted) ? deleted : null,
		mailboxArchived: url.searchParams.get('archived') === '1'
	};
};
