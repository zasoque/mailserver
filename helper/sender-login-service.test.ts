import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SenderLoginService, generateSenderLoginSource } from './sender-login-service';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('SenderLoginService', () => {
	test('maps accounts to themselves and aliases to their active destinations', async () => {
		const fixture = await createFixture();
		expect(await generateSenderLoginSource(fixture.users, fixture.aliases)).toBe(
			'admin@zasoque.org\tbob@zasoque.org\n' +
				'alice@zasoque.org\talice@zasoque.org\n' +
				'bob@zasoque.org\tbob@zasoque.org\n' +
				'hello@zasoque.org\talice@zasoque.org\n'
		);
	});

	test('moves and removes authorization when alias source changes', async () => {
		const fixture = await createFixture();
		await fixture.service().rebuildFromSources();
		await writeFile(fixture.aliases, 'hello@zasoque.org bob@zasoque.org\n', { mode: 0o600 });
		await fixture.service().rebuildFromSources();
		expect(await readFile(fixture.sender, 'utf8')).toContain('hello@zasoque.org\tbob@zasoque.org');
		await writeFile(fixture.aliases, '', { mode: 0o600 });
		await fixture.service().rebuildFromSources();
		expect(await readFile(fixture.sender, 'utf8')).not.toContain('hello@zasoque.org');
	});

	test('rolls source back and rebuilds old database after postmap failure', async () => {
		const fixture = await createFixture();
		let calls = 0;
		const service = fixture.service(async () => {
			if (++calls === 1) throw new Error('failed');
		});
		await expect(service.rebuildFromSources()).rejects.toMatchObject({ code: 'postmap_failed' });
		expect(await readFile(fixture.sender, 'utf8')).toBe('original\n');
		expect(calls).toBe(2);
	});

	test('rejects malformed aliases, inactive destinations, and symlink source', async () => {
		const fixture = await createFixture();
		await writeFile(fixture.aliases, 'bad row with fields\n');
		await expect(generateSenderLoginSource(fixture.users, fixture.aliases)).rejects.toThrow();
		await writeFile(fixture.aliases, 'hello@zasoque.org missing@zasoque.org\n');
		await expect(generateSenderLoginSource(fixture.users, fixture.aliases)).rejects.toThrow(
			/not an active/
		);
		await rm(fixture.sender);
		await symlink(fixture.users, fixture.sender);
		await expect(fixture.service().verifyMutationAccess()).rejects.toThrow(/group-readable/);
	});
});

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'sender-login-test-'));
	roots.push(root);
	const users = path.join(root, 'users');
	const aliases = path.join(root, 'virtual_alias');
	const sender = path.join(root, 'sender_login');
	const backups = path.join(root, 'backups');
	await writeFile(users, 'alice@zasoque.org:{CRYPT}x\nbob@zasoque.org:{CRYPT}y\n');
	await writeFile(
		aliases,
		'hello@zasoque.org alice@zasoque.org\nadmin@zasoque.org bob@zasoque.org\n'
	);
	await writeFile(sender, 'original\n', { mode: 0o640 });
	await mkdir(backups, { mode: 0o700 });
	return {
		users,
		aliases,
		sender,
		service: (runPostmap: () => Promise<void> = async () => undefined) =>
			new SenderLoginService(
				{
					usersFilePath: users,
					aliasFilePath: aliases,
					senderLoginFilePath: sender,
					backupDirectoryPath: backups,
					postmapPath: '/unused'
				},
				{ runPostmap }
			)
	};
}
