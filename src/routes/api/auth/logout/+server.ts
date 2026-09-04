import { json } from '@sveltejs/kit';
import { destroyAdminSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
	destroyAdminSession(cookies);
	return json({ authenticated: false });
};
