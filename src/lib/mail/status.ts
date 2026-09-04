export type ServiceState = 'running' | 'down' | 'unavailable';

export interface MailServerStatus {
	services: Record<'smtp' | 'submission' | 'imaps' | 'dkim', { status: ServiceState }>;
	accounts: number | null;
	aliases: number | null;
	deletedAccounts: number | null;
	mailStorageBytes: number | null;
	deletedMailBytes: number | null;
	queue: { messages: number | null };
}
