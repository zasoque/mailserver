export interface MailAccountSummary {
	address: string;
	usageBytes: number | null;
}

export interface AccountsApiResponse {
	accounts: MailAccountSummary[];
}

export interface AccountsApiError {
	error: {
		code: 'permission_denied' | 'users_file_not_found' | 'repository_error';
		message: string;
	};
}
