export function isProtectedAdminPage(pathname: string): boolean {
	return (
		pathname === '/accounts' ||
		pathname.startsWith('/accounts/') ||
		pathname === '/aliases' ||
		pathname.startsWith('/aliases/') ||
		pathname === '/dashboard' ||
		pathname === '/deleted' ||
		pathname.startsWith('/deleted/')
	);
}

export function isProtectedAdminApi(pathname: string): boolean {
	return (
		pathname === '/api/accounts' ||
		pathname.startsWith('/api/accounts/') ||
		pathname === '/api/aliases' ||
		pathname.startsWith('/api/aliases/') ||
		pathname === '/api/status' ||
		pathname === '/api/deleted' ||
		pathname.startsWith('/api/deleted/')
	);
}
