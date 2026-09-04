import { describe, expect, test } from 'bun:test';
import { StatusService } from './status-service';

const accounts = {
	list: async () => ({ accounts: [{ address: 'a@zasoque.org', usageBytes: 100 }] })
};
const aliases = {
	list: async () => ({ aliases: [{ address: 'x@zasoque.org', destination: 'a@zasoque.org' }] })
};
const deleted = {
	list: async () => ({
		archives: [
			{ id: 'id', address: 'b@zasoque.org', deletedAt: new Date().toISOString(), usageBytes: 25 }
		]
	})
};

describe('StatusService', () => {
	test('returns counts, storage, service states, and queue count', async () => {
		const service = new StatusService(
			accounts as never,
			aliases as never,
			deleted as never,
			{ postqueuePath: '/unused' },
			{ probe: async () => 'running', queueCount: async () => 3 }
		);
		const result = await service.get();
		expect(result.accounts).toBe(1);
		expect(result.aliases).toBe(1);
		expect(result.deletedAccounts).toBe(1);
		expect(result.mailStorageBytes).toBe(100);
		expect(result.deletedMailBytes).toBe(25);
		expect(result.queue.messages).toBe(3);
		expect(result.services.smtp.status).toBe('running');
	});

	test('isolates probe and queue failures', async () => {
		const service = new StatusService(
			accounts as never,
			aliases as never,
			deleted as never,
			{ postqueuePath: '/unused' },
			{
				probe: async (_host, port) => {
					if (port === 25) throw new Error('probe failure');
					return 'down';
				},
				queueCount: async () => {
					throw new Error('queue failure');
				}
			}
		);
		const result = await service.get();
		expect(result.services.smtp.status).toBe('unavailable');
		expect(result.services.submission.status).toBe('down');
		expect(result.queue.messages).toBeNull();
		expect(result.accounts).toBe(1);
	});
});
