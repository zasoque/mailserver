import { env } from '$env/dynamic/private';
import { json, redirect, type Handle } from '@sveltejs/kit';
import { getAdminSession } from '$lib/server/auth';
import { isProtectedAdminApi, isProtectedAdminPage } from '$lib/server/auth-routing';

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

	const protectedPage = isProtectedAdminPage(pathname);
	const protectedApi = isProtectedAdminApi(pathname);
	const logoutApi = pathname === '/api/auth/logout';
	if (pathname === '/') redirect(303, event.locals.adminUsername ? '/dashboard' : '/login');
	if (!event.locals.adminUsername && (protectedPage || protectedApi || logoutApi)) {
		if (protectedApi || logoutApi) {
			return json(
				{ error: { code: 'unauthorized', message: 'Authentication required.' } },
				{ status: 401 }
			);
		}
		redirect(303, `/login?next=${encodeURIComponent(pathname)}`);
	}

	if (event.locals.adminUsername && pathname === '/login') redirect(303, '/dashboard');
	return resolve(event);
};
