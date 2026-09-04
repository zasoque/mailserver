import type { DeletedAccountsResponse } from '$lib/mail/deleted';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/deleted');
	if (!response.ok) return { archives: [], loadError: 'Deleted accounts could not be loaded.' };
	return {
		archives: ((await response.json()) as DeletedAccountsResponse).archives,
		loadError: null
	};
};
