export interface DeletedAccountArchive {
	id: string;
	address: string;
	deletedAt: string;
	usageBytes: number | null;
}

export interface DeletedAccountsResponse {
	archives: DeletedAccountArchive[];
}

export interface RestoreDeletedAccountRequest {
	password: string;
	confirmPassword: string;
}

export interface RestoreDeletedAccountResponse {
	id: string;
	address: string;
	restored: true;
}

export interface PermanentlyDeleteArchiveRequest {
	confirmation: string;
}

export interface PermanentlyDeleteArchiveResponse {
	id: string;
	address: string;
	usageBytes: number | null;
	permanentlyDeleted: true;
}

const ARCHIVE_ID_PATTERN = /^\d{8}T\d{9}-([a-z0-9._-]{1,64}@zasoque\.org)$/;

export function archiveAddressFromId(value: unknown): string | null {
	return typeof value === 'string' ? (ARCHIVE_ID_PATTERN.exec(value)?.[1] ?? null) : null;
}
