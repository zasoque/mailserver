import type { AccountsApiError, AccountsApiResponse } from '$lib/mail/accounts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/accounts');
	if (!response.ok) {
		const body = (await response.json()) as AccountsApiError;
		return { accounts: [], loadError: body.error };
	}

	const body = (await response.json()) as AccountsApiResponse;
	return { accounts: body.accounts, loadError: null };
};
