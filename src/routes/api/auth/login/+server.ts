import { json } from '@sveltejs/kit';
import { createAdminSession, verifyAdminCredentials } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return invalidCredentials();
	}
	if (!isLoginRequest(body)) return invalidCredentials();
	if (!(await verifyAdminCredentials(body.username, body.password))) return invalidCredentials();

	createAdminSession(cookies);
	return json({ authenticated: true });
};

function isLoginRequest(value: unknown): value is { username: string; password: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'username' in value &&
		'password' in value &&
		typeof value.username === 'string' &&
		value.username.length <= 64 &&
		typeof value.password === 'string' &&
		value.password.length <= 1024
	);
}

function invalidCredentials() {
	return json(
		{ error: { code: 'invalid_credentials', message: 'Invalid username or password.' } },
		{ status: 401 }
	);
}
