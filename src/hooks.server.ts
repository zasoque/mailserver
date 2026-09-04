import { env } from '$env/dynamic/private';
import { json, redirect, type Handle } from '@sveltejs/kit';
import { getAdminSession } from '$lib/server/auth';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.adminUsername = getAdminSession(event.cookies);
	const pathname = event.url.pathname;

	if (pathname.startsWith('/api/') && UNSAFE_METHODS.has(event.request.method)) {
		const expectedOrigin = env.ORIGIN ?? event.url.origin;
		if (event.request.headers.get('origin') !== expectedOrigin) {
			return json(
				{ error: { code: 'invalid_request', message: 'Invalid request origin.' } },
				{ status: 403 }
			);
		}
	}

	const protectedPage = pathname === '/accounts' || pathname.startsWith('/accounts/');
	const protectedApi = pathname === '/api/accounts' || pathname.startsWith('/api/accounts/');
	const logoutApi = pathname === '/api/auth/logout';
	if (!event.locals.adminUsername && (protectedPage || protectedApi || logoutApi)) {
		if (protectedApi || logoutApi) {
			return json(
				{ error: { code: 'unauthorized', message: 'Authentication required.' } },
				{ status: 401 }
			);
		}
		redirect(303, `/login?next=${encodeURIComponent(pathname)}`);
	}

	if (event.locals.adminUsername && pathname === '/login') redirect(303, '/accounts');
	return resolve(event);
};
