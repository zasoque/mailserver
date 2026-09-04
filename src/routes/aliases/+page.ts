import { error } from '@sveltejs/kit';
import type { AccountsApiResponse } from '$lib/mail/accounts';
import type { AliasesApiResponse } from '$lib/mail/aliases';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [aliasesResponse, accountsResponse] = await Promise.all([
		fetch('/api/aliases'),
		fetch('/api/accounts')
	]);
	if (!aliasesResponse.ok || !accountsResponse.ok) error(502, 'Aliases could not be loaded.');
	return {
		aliases: ((await aliasesResponse.json()) as AliasesApiResponse).aliases,
		accounts: ((await accountsResponse.json()) as AccountsApiResponse).accounts
	};
};
