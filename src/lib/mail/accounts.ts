export interface MailAccountSummary {
	address: string;
	usageBytes: number | null;
}

export interface AccountsApiResponse {
	accounts: MailAccountSummary[];
}

export interface AccountsApiError {
	error: {
		code:
			| 'permission_denied'
			| 'users_file_not_found'
			| 'repository_error'
			| 'invalid_request'
			| 'account_exists'
			| 'helper_unavailable'
			| 'creation_failed';
		message: string;
	};
}

export interface CreateAccountRequest {
	username: string;
	domain: 'zasoque.org';
	password: string;
}

export interface CreateAccountResponse {
	address: string;
	maildir: string;
	created: true;
}
