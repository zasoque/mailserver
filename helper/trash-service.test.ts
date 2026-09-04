import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TrashService } from './trash-service';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('TrashService', () => {
	test('returns Trash message count and virtual size for an active account', async () => {
		const fixture = await setup();
		const calls: readonly string[][] = [];
		const service = fixture.service(async (args) => {
			calls.push(args);
			return args[0] === 'mailbox'
				? 'INBOX\nSent\nTrash\n'
				: '[{"mailbox":"Trash","messages":"12","vsize":"9123456"}]';
		});
		expect(await service.status('test@zasoque.org')).toEqual({
			mailbox: 'Trash',
			exists: true,
			messages: 12,
			bytes: 9123456
		});
		expect(calls[1]).toEqual([
			'-f',
			'json',
			'mailbox',
			'status',
			'-u',
			'test@zasoque.org',
			'messages vsize',
			'Trash'
		]);
	});

	test('treats a missing Trash mailbox as an empty normal state', async () => {
		const fixture = await setup();
		const service = fixture.service(async () => 'INBOX\nSent\n');
		expect(await service.status('test@zasoque.org')).toEqual({
			mailbox: 'Trash',
			exists: false,
			messages: 0,
			bytes: 0
		});
	});

	test('rejects invalid and alias-only addresses before running doveadm', async () => {
		const fixture = await setup();
		let calls = 0;
		const service = fixture.service(async () => {
			calls += 1;
			return '';
		});
		for (const address of ['../test@zasoque.org', 'test;whoami@zasoque.org', 'test@example.com']) {
			await expect(Promise.resolve().then(() => service.status(address))).rejects.toMatchObject({
				code: 'invalid_request'
			});
		}
		await expect(service.status('alias@zasoque.org')).rejects.toMatchObject({
			code: 'account_not_found'
		});
		expect(calls).toBe(0);
	});

	test('expunges only the fixed Trash mailbox and verifies it is empty', async () => {
		const fixture = await setup();
		const calls: readonly string[][] = [];
		let statusReads = 0;
		const service = fixture.service(async (args) => {
			calls.push(args);
			if (args[0] === 'expunge') return '';
			if (args[0] === 'mailbox') return 'Trash\n';
			statusReads += 1;
			return JSON.stringify([
				{ mailbox: 'Trash', messages: statusReads === 1 ? 2 : 0, vsize: statusReads === 1 ? 50 : 0 }
			]);
		});
		const result = await service.empty('test@zasoque.org', { confirmed: true });
		expect(result.messages).toBe(0);
		expect(result.emptied).toBeTrue();
		expect(calls).toContainEqual(['expunge', '-u', 'test@zasoque.org', 'mailbox', 'Trash', 'all']);
		expect(calls.flat()).not.toContain('INBOX');
	});

	test('requires confirmation and reports doveadm expunge failure', async () => {
		const fixture = await setup();
		const service = fixture.service(async (args) => {
			if (args[0] === 'mailbox') return 'Trash\n';
			if (args[0] === '-f') return '[{"messages":1,"vsize":10}]';
			throw new Error('simulated failure');
		});
		await expect(
			Promise.resolve().then(() => service.empty('test@zasoque.org', {}))
		).rejects.toMatchObject({ code: 'invalid_request' });
		await expect(service.empty('test@zasoque.org', { confirmed: true })).rejects.toMatchObject({
			code: 'trash_operation_failed'
		});
	});
});

async function setup() {
	const root = await mkdtemp(path.join(tmpdir(), 'trash-service-'));
	roots.push(root);
	const usersFilePath = path.join(root, 'users');
	await writeFile(usersFilePath, 'test@zasoque.org:{CRYPT}$2y$test\n');
	return {
		service: (runDoveadm: (args: readonly string[]) => Promise<string>) =>
			new TrashService({ usersFilePath, doveadmPath: '/unused' }, { runDoveadm })
	};
}
