import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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

	test('changes only the selected account password hash and creates a backup', async () => {
		const initial =
			'first@zasoque.org:{CRYPT}$2y$first:extra\r\n' +
			'toku@zasoque.org:{CRYPT}$2y$old:uid=500\r\n' +
			'last@zasoque.org:{CRYPT}$2y$last\r\n';
		const fixture = await createFixture(initial);
		const beforeStat = await stat(fixture.usersFilePath);

		const result = await fixture.creator().changePassword('toku@zasoque.org', {
			password: 'new-secret',
			confirmPassword: 'new-secret'
		});

		expect(result).toEqual({ address: 'toku@zasoque.org', passwordChanged: true });
		expect(await readFile(fixture.usersFilePath, 'utf8')).toBe(
			initial.replace('{CRYPT}$2y$old', '{BLF-CRYPT}$2y$test-hash')
		);
		const afterStat = await stat(fixture.usersFilePath);
		expect(afterStat.mode & 0o7777).toBe(beforeStat.mode & 0o7777);
		expect(afterStat.uid).toBe(beforeStat.uid);
		expect(afterStat.gid).toBe(beforeStat.gid);
		expect((await readdir(fixture.root)).filter((name) => name.endsWith('.bak'))).toHaveLength(1);
	});

	test('rejects a password confirmation mismatch without changing the users file', async () => {
		const initial = 'toku@zasoque.org:{CRYPT}$2y$old\n';
		const fixture = await createFixture(initial);

		await expect(
			fixture.creator().changePassword('toku@zasoque.org', {
				password: 'new-secret',
				confirmPassword: 'different'
			})
		).rejects.toMatchObject({ code: 'invalid_request' });
		expect(await readFile(fixture.usersFilePath, 'utf8')).toBe(initial);
	});

	test('returns not found for a missing account', async () => {
		const fixture = await createFixture('other@zasoque.org:{CRYPT}$2y$old\n');

		await expect(
			fixture.creator().changePassword('missing@zasoque.org', {
				password: 'new-secret',
				confirmPassword: 'new-secret'
			})
		).rejects.toMatchObject({ code: 'account_not_found' });
	});

	test('rejects invalid and non-zasoque.org addresses', async () => {
		const fixture = await createFixture('toku@zasoque.org:{CRYPT}$2y$old\n');
		for (const address of ['../toku@zasoque.org', 'Toku@zasoque.org', 'toku@example.com']) {
			await expect(
				fixture.creator().changePassword(address, {
					password: 'new-secret',
					confirmPassword: 'new-secret'
				})
			).rejects.toMatchObject({ code: 'invalid_request' });
		}
	});

	test('deletes only the account line and archives the complete Maildir', async () => {
		const initial =
			'first@zasoque.org:{CRYPT}$2y$first\r\n' +
			'test@zasoque.org:{CRYPT}$2y$test:extra\r\n' +
			'last@zasoque.org:{CRYPT}$2y$last\r\n';
		const fixture = await createFixture(initial);
		const maildir = path.join(fixture.vmailRoot, 'zasoque.org', 'test', 'Maildir');
		await mkdir(path.join(maildir, 'cur'), { recursive: true });
		await mkdir(path.join(maildir, 'new'));
		await mkdir(path.join(maildir, 'tmp'));
		await writeFile(path.join(maildir, 'cur', 'message'), 'mail body');

		const result = await fixture.creator().delete('test@zasoque.org');

		expect(result).toEqual({ address: 'test@zasoque.org', deleted: true, mailboxArchived: true });
		expect(await readFile(fixture.usersFilePath, 'utf8')).toBe(
			'first@zasoque.org:{CRYPT}$2y$first\r\nlast@zasoque.org:{CRYPT}$2y$last\r\n'
		);
		expect(await readdir(path.join(fixture.vmailRoot, 'zasoque.org'))).not.toContain('test');
		const archives = await readdir(path.join(fixture.vmailRoot, '.deleted'));
		expect(archives).toHaveLength(1);
		expect(archives[0]).toMatch(/^\d{8}T\d{9}-test@zasoque\.org$/);
		expect(
			await readFile(
				path.join(fixture.vmailRoot, '.deleted', archives[0], 'Maildir', 'cur', 'message'),
				'utf8'
			)
		).toBe('mail body');
	});

	test('restores authentication when mailbox archiving fails', async () => {
		const initial = 'test@zasoque.org:{CRYPT}$2y$test\n';
		const fixture = await createFixture(initial);
		await mkdir(path.join(fixture.vmailRoot, 'zasoque.org', 'test', 'Maildir'), {
			recursive: true
		});
		const creator = fixture.creator(
			async () => undefined,
			async () => {
				throw new Error('simulated archive failure');
			}
		);

		await expect(creator.delete('test@zasoque.org')).rejects.toMatchObject({
			code: 'filesystem_error'
		});
		expect(await readFile(fixture.usersFilePath, 'utf8')).toBe(initial);
		expect(await readdir(path.join(fixture.vmailRoot, 'zasoque.org'))).toContain('test');
	});

	test('refuses to delete the protected account', async () => {
		const fixture = await createFixture('jeonhangyeol@zasoque.org:{CRYPT}$2y$owner\n');
		await expect(fixture.creator().delete('jeonhangyeol@zasoque.org')).rejects.toMatchObject({
			code: 'protected_account'
		});
	});

	test('returns not found when deleting a missing account', async () => {
		const fixture = await createFixture('other@zasoque.org:{CRYPT}$2y$other\n');
		await expect(fixture.creator().delete('test@zasoque.org')).rejects.toMatchObject({
			code: 'account_not_found'
		});
	});

	test('refuses to delete an account used as an alias destination', async () => {
		const fixture = await createFixture('test@zasoque.org:{CRYPT}$2y$test\n');
		const aliasFilePath = path.join(fixture.root, 'virtual_alias');
		await writeFile(aliasFilePath, 'admin@zasoque.org test@zasoque.org\n');
		const creator = new AccountCreator(
			{
				usersFilePath: fixture.usersFilePath,
				vmailRoot: fixture.vmailRoot,
				doveadmPath: '/unused',
				uid: 500,
				gid: 500,
				virtualAliasFilePath: aliasFilePath
			},
			{ hashPassword: async () => '{BLF-CRYPT}$2y$test-hash', chownTree: async () => undefined }
		);
		await expect(creator.delete('test@zasoque.org')).rejects.toMatchObject({
			code: 'alias_in_use'
		});
		expect(await readFile(fixture.usersFilePath, 'utf8')).toContain('test@zasoque.org:');
	});

	test('refuses to create an account over an existing alias address', async () => {
		const fixture = await createFixture('');
		const aliasFilePath = path.join(fixture.root, 'virtual_alias');
		await writeFile(aliasFilePath, 'contact@zasoque.org jeonhangyeol@zasoque.org\n');
		const creator = new AccountCreator(
			{
				usersFilePath: fixture.usersFilePath,
				vmailRoot: fixture.vmailRoot,
				doveadmPath: '/unused',
				uid: 500,
				gid: 500,
				virtualAliasFilePath: aliasFilePath
			},
			{ hashPassword: async () => '{BLF-CRYPT}$2y$test-hash', chownTree: async () => undefined }
		);
		await expect(
			creator.create({ username: 'contact', domain: 'zasoque.org', password: 'secret' })
		).rejects.toMatchObject({ code: 'account_address_conflict' });
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
		creator: (
			chownTree: () => Promise<void> = async () => undefined,
			moveMailbox?: (source: string, destination: string) => Promise<void>
		) =>
			new AccountCreator(
				{ usersFilePath, vmailRoot, doveadmPath: '/unused', uid: 500, gid: 500 },
				{
					hashPassword: async () => '{BLF-CRYPT}$2y$test-hash',
					chownTree,
					moveMailbox
				}
			)
	};
}
