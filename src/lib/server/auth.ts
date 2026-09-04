import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { compare } from 'bcryptjs';
import type { Cookies } from '@sveltejs/kit';

const SESSION_COOKIE = 'mail_admin_session';
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const sessions = new Map<string, { username: string; expiresAt: number }>();

interface AuthConfig {
	username: string;
	passwordHash: string;
	sessionSecret: string;
}

let cachedConfig: AuthConfig | undefined;

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
	const config = getAuthConfig();
	const passwordMatches = await compare(password, config.passwordHash).catch(() => false);
	return passwordMatches && constantTimeEqual(username, config.username);
}

export function createAdminSession(cookies: Cookies): void {
	const config = getAuthConfig();
	const token = randomBytes(32).toString('base64url');
	const expiresAt = Date.now() + SESSION_LIFETIME_SECONDS * 1000;
	removeExpiredSessions();
	sessions.set(sessionKey(token, config.sessionSecret), { username: config.username, expiresAt });
	cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_LIFETIME_SECONDS));
}

export function getAdminSession(cookies: Cookies): string | null {
	const token = cookies.get(SESSION_COOKIE);
	if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const session = sessions.get(sessionKey(token, getAuthConfig().sessionSecret));
	if (!session) return null;
	if (session.expiresAt <= Date.now()) {
		sessions.delete(sessionKey(token, getAuthConfig().sessionSecret));
		return null;
	}
	return session.username;
}

export function destroyAdminSession(cookies: Cookies): void {
	const token = cookies.get(SESSION_COOKIE);
	if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
		sessions.delete(sessionKey(token, getAuthConfig().sessionSecret));
	}
	cookies.delete(SESSION_COOKIE, cookieOptions(0));
}

function getAuthConfig(): AuthConfig {
	if (cachedConfig) return cachedConfig;
	const username = env.MAIL_ADMIN_USERNAME;
	const passwordHash = env.MAIL_ADMIN_PASSWORD_HASH;
	const sessionSecret = env.MAIL_ADMIN_SESSION_SECRET;
	if (!username || !/^[A-Za-z0-9._-]{1,64}$/.test(username)) {
		throw new Error('MAIL_ADMIN_USERNAME is missing or invalid.');
	}
	if (!passwordHash || !/^\$2[aby]\$(?:1[2-9]|2\d|3[01])\$/.test(passwordHash)) {
		throw new Error('MAIL_ADMIN_PASSWORD_HASH must be a bcrypt hash with cost 12 or greater.');
	}
	if (!sessionSecret || Buffer.byteLength(sessionSecret, 'utf8') < 32) {
		throw new Error('MAIL_ADMIN_SESSION_SECRET must contain at least 32 bytes.');
	}
	cachedConfig = { username, passwordHash, sessionSecret };
	return cachedConfig;
}

function sessionKey(token: string, secret: string): string {
	return createHmac('sha256', secret).update(token).digest('base64url');
}

function constantTimeEqual(first: string, second: string): boolean {
	const firstDigest = createHash('sha256').update(first).digest();
	const secondDigest = createHash('sha256').update(second).digest();
	return timingSafeEqual(firstDigest, secondDigest);
}

function removeExpiredSessions(): void {
	const now = Date.now();
	for (const [key, session] of sessions) {
		if (session.expiresAt <= now) sessions.delete(key);
	}
}

function cookieOptions(maxAge: number) {
	return {
		httpOnly: true,
		secure: env.NODE_ENV === 'production',
		sameSite: 'lax' as const,
		path: '/',
		maxAge
	};
}
