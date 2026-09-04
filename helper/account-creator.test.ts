import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AccountCreator, AccountCreatorError } from './account-creator';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('AccountCreator', () => {
	test('creates an account, backup, and Maildir without exposing the hash', async () => {
		const fixture = await createFixture();
		const creator = fixture.creator();

		const result = await creator.create({
			username: 'toku',
			domain: 'zasoque.org',
			password: 'secret-value'
		});

		expect(result).toEqual({
			address: 'toku@zasoque.org',
			maildir: path.join(fixture.vmailRoot, 'zasoque.org', 'toku', 'Maildir'),
			created: true
		});
		expect(JSON.stringify(result)).not.toContain('hash');
		expect(await readFile(fixture.usersFilePath, 'utf8')).toContain(
			'toku@zasoque.org:{BLF-CRYPT}$2y$test-hash'
		);
		const maildirEntries = await readdir(result.maildir);
		expect(maildirEntries.sort()).toEqual(['cur', 'new', 'tmp']);
		const backups = (await readdir(fixture.root)).filter((name) => name.endsWith('.bak'));
		expect(backups).toHaveLength(1);
	});

	test('returns a conflict for an existing account', async () => {
		const fixture = await createFixture('toku@zasoque.org:{CRYPT}$2y$existing\n');
		const creator = fixture.creator();

		await expect(
			creator.create({ username: 'toku', domain: 'zasoque.org', password: 'secret' })
		).rejects.toMatchObject({ code: 'account_exists' });
	});

	test('rejects traversal and invalid usernames', async () => {
		const fixture = await createFixture();
		const creator = fixture.creator();

		for (const username of ['../toku', 'Toku', 'a/b', '', 'a'.repeat(65)]) {
			await expect(
				creator.create({ username, domain: 'zasoque.org', password: 'secret' })
			).rejects.toBeInstanceOf(AccountCreatorError);
		}
	});

	test('restores the users file and removes the mail home when chown fails', async () => {
		const fixture = await createFixture('existing@zasoque.org:{CRYPT}$2y$existing\n');
		const original = await readFile(fixture.usersFilePath, 'utf8');
		const creator = fixture.creator(async () => {
			throw new Error('simulated chown failure');
		});

		await expect(
			creator.create({ username: 'toku', domain: 'zasoque.org', password: 'secret' })
		).rejects.toMatchObject({ code: 'filesystem_error' });
		expect(await readFile(fixture.usersFilePath, 'utf8')).toBe(original);
		expect(
			await readdir(path.join(fixture.vmailRoot, 'zasoque.org')).catch(() => [])
		).not.toContain('toku');
	});
});

async function createFixture(initialUsers = '') {
	const root = await mkdtemp(path.join(tmpdir(), 'mail-helper-test-'));
	temporaryDirectories.push(root);
	const usersFilePath = path.join(root, 'users');
	const vmailRoot = path.join(root, 'vmail');
	await writeFile(usersFilePath, initialUsers, { mode: 0o600 });

	return {
		root,
		usersFilePath,
		vmailRoot,
		creator: (chownTree: () => Promise<void> = async () => undefined) =>
			new AccountCreator(
				{ usersFilePath, vmailRoot, doveadmPath: '/unused', uid: 500, gid: 500 },
				{
					hashPassword: async () => '{BLF-CRYPT}$2y$test-hash',
					chownTree
				}
			)
	};
}
