import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DeletedAccountService } from './deleted-account-service';

const roots: string[] = [];
const ID = '20260904T083200000-test@zasoque.org';

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('DeletedAccountService', () => {
	test('parses and lists archives with sizes', async () => {
		const fixture = await setup();
		await archive(fixture, ID, 'mail body');
		const result = await fixture.service().list();
		expect(result.archives).toHaveLength(1);
		expect(result.archives[0]).toMatchObject({ id: ID, address: 'test@zasoque.org' });
		expect(result.archives[0].deletedAt).toBe('2026-09-04T08:32:00.000Z');
		expect(result.archives[0].usageBytes).toBe(9);
	});

	test('rejects invalid ids, traversal, and a symlink archive', async () => {
		const fixture = await setup();
		const outside = path.join(fixture.root, 'outside');
		await mkdir(outside);
		await symlink(outside, path.join(fixture.archiveRoot, ID));
		for (const id of ['../../outside', 'invalid', ID]) {
			await expect(
				Promise.resolve().then(() =>
					fixture.service().permanentlyDelete(id, { confirmation: 'test@zasoque.org' })
				)
			).rejects.toMatchObject({ code: 'invalid_request' });
		}
		expect(await readdir(outside)).toEqual([]);
	});

	test('requires exact confirmation and permanently deletes only the archive', async () => {
		const fixture = await setup();
		await archive(fixture, ID, 'mail');
		await expect(
			fixture.service().permanentlyDelete(ID, { confirmation: 'other@zasoque.org' })
		).rejects.toMatchObject({ code: 'confirmation_mismatch' });
		const result = await fixture
			.service()
			.permanentlyDelete(ID, { confirmation: 'test@zasoque.org' });
		expect(result).toMatchObject({ address: 'test@zasoque.org', permanentlyDeleted: true });
		expect(await readdir(fixture.archiveRoot)).toEqual([]);
	});

	test('restores a mailbox and creates a new authentication entry', async () => {
		const fixture = await setup();
		await archive(fixture, ID, 'mail');
		const result = await fixture.service().restore(ID, {
			password: 'new-secret',
			confirmPassword: 'new-secret'
		});
		expect(result).toEqual({ id: ID, address: 'test@zasoque.org', restored: true });
		expect(await readFile(fixture.usersFile, 'utf8')).toContain(
			'test@zasoque.org:{BLF-CRYPT}$2y$restore-test'
		);
		expect(
			await readFile(
				path.join(fixture.vmailRoot, 'zasoque.org', 'test', 'Maildir', 'cur', 'mail'),
				'utf8'
			)
		).toBe('mail');
	});

	test('rejects restore for an existing account or alias collision', async () => {
		const existing = await setup('test@zasoque.org:{CRYPT}$2y$existing\n');
		await archive(existing, ID, 'mail');
		await expect(
			existing.service().restore(ID, { password: 'x', confirmPassword: 'x' })
		).rejects.toMatchObject({ code: 'account_exists' });

		const aliased = await setup('', 'test@zasoque.org other@zasoque.org\n');
		await archive(aliased, ID, 'mail');
		await expect(
			aliased.service().restore(ID, { password: 'x', confirmPassword: 'x' })
		).rejects.toMatchObject({ code: 'account_address_conflict' });
	});

	test('rolls the users file and mailbox back when restore fails', async () => {
		const fixture = await setup('other@zasoque.org:{CRYPT}$2y$existing\n');
		await archive(fixture, ID, 'mail');
		const original = await readFile(fixture.usersFile, 'utf8');
		await expect(
			fixture
				.service(async () => {
					throw new Error('simulated chown failure');
				})
				.restore(ID, { password: 'x', confirmPassword: 'x' })
		).rejects.toMatchObject({ code: 'filesystem_error' });
		expect(await readFile(fixture.usersFile, 'utf8')).toBe(original);
		expect(await readdir(fixture.archiveRoot)).toContain(ID);
	});
});

async function setup(users = '', aliases = '') {
	const root = await mkdtemp(path.join(tmpdir(), 'deleted-service-'));
	roots.push(root);
	const usersFile = path.join(root, 'users');
	const aliasFile = path.join(root, 'virtual_alias');
	const vmailRoot = path.join(root, 'vmail');
	const archiveRoot = path.join(vmailRoot, '.deleted');
	await writeFile(usersFile, users, { mode: 0o640 });
	await writeFile(aliasFile, aliases);
	await mkdir(archiveRoot, { recursive: true });
	return {
		root,
		usersFile,
		aliasFile,
		vmailRoot,
		archiveRoot,
		service: (chownTree: () => Promise<void> = async () => undefined) =>
			new DeletedAccountService(
				{
					usersFilePath: usersFile,
					vmailRoot,
					virtualAliasFilePath: aliasFile,
					doveadmPath: '/unused',
					uid: 500,
					gid: 500
				},
				{ hashPassword: async () => '{BLF-CRYPT}$2y$restore-test', chownTree }
			)
	};
}

async function archive(fixture: Awaited<ReturnType<typeof setup>>, id: string, contents: string) {
	const maildir = path.join(fixture.archiveRoot, id, 'Maildir', 'cur');
	await mkdir(maildir, { recursive: true });
	await writeFile(path.join(maildir, 'mail'), contents);
}
