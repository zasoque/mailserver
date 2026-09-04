import { error } from '@sveltejs/kit';
import type { AccountsApiResponse } from '$lib/mail/accounts';
import type { TrashStatus } from '$lib/mail/trash';
import type { PageLoad } from './$types';

const ADDRESS_PATTERN = /^([a-z0-9._-]{1,64})@zasoque\.org$/;

export const load: PageLoad = async ({ params, fetch }) => {
	const match = ADDRESS_PATTERN.exec(params.address);
	if (!match) error(404, 'Mail account not found.');

	const [response, trashResponse] = await Promise.all([
		fetch('/api/accounts'),
		fetch(`/api/accounts/${encodeURIComponent(params.address)}/trash`)
	]);
	if (!response.ok) error(response.status, 'Mail account details could not be loaded.');
	const body = (await response.json()) as AccountsApiResponse;
	const account = body.accounts.find(({ address }) => address === params.address);
	if (!account) error(404, 'Mail account not found.');

	return {
		account,
		maildir: `/Users/Shared/vmail/zasoque.org/${match[1]}/Maildir`,
		trash: trashResponse.ok ? ((await trashResponse.json()) as TrashStatus) : null,
		trashError: trashResponse.ok ? null : 'Trash status is unavailable.'
	};
};
