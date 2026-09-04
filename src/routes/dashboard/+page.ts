import type { MailServerStatus } from '$lib/mail/status';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/status');
	if (!response.ok) return { status: null, loadError: 'Server status could not be loaded.' };
	return { status: (await response.json()) as MailServerStatus, loadError: null };
};
