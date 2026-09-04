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
			| 'account_not_found'
			| 'protected_account'
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

export interface ChangePasswordRequest {
	password: string;
	confirmPassword: string;
}

export interface ChangePasswordResponse {
	address: string;
	passwordChanged: true;
}

export interface DeleteAccountResponse {
	address: string;
	deleted: true;
	mailboxArchived: boolean;
}
