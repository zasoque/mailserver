import { error } from '@sveltejs/kit';
import type { AccountsApiResponse } from '$lib/mail/accounts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/accounts');
	if (!response.ok) error(502, 'Accounts could not be loaded.');
	return { accounts: ((await response.json()) as AccountsApiResponse).accounts };
};
