import { describe, expect, test } from 'bun:test';
import { isProtectedAdminApi, isProtectedAdminPage } from '../src/lib/server/auth-routing';

describe('admin route protection', () => {
	test('protects status and deleted APIs from unauthenticated access', () => {
		expect(isProtectedAdminApi('/api/status')).toBeTrue();
		expect(isProtectedAdminApi('/api/deleted')).toBeTrue();
		expect(isProtectedAdminApi('/api/deleted/archive/restore')).toBeTrue();
	});

	test('protects dashboard and deleted pages', () => {
		expect(isProtectedAdminPage('/dashboard')).toBeTrue();
		expect(isProtectedAdminPage('/deleted')).toBeTrue();
	});
});
