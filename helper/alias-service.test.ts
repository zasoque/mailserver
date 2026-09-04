import { afterEach, describe, expect, test } from 'bun:test';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AliasService } from './alias-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('AliasService', () => {
	test('lists existing aliases without comments', async () => {
		const fixture = await createFixture(
			'# aliases\nadmin@zasoque.org  jeonhangyeol@zasoque.org\n\n'
		);
		expect(await fixture.service().list()).toEqual({
			aliases: [{ address: 'admin@zasoque.org', destination: 'jeonhangyeol@zasoque.org' }]
		});
	});

	test('preflights the external backup directory and existing source without changing it', async () => {
		const fixture = await createFixture('admin@zasoque.org jeonhangyeol@zasoque.org\n');
		const original = await readFile(fixture.aliasFilePath, 'utf8');
		await fixture.service().verifyMutationAccess();
		expect(await readFile(fixture.aliasFilePath, 'utf8')).toBe(original);
		expect(await readdir(fixture.backupDirectoryPath)).toEqual([]);
	});

	test('creates an alias, preserves metadata, backs up source, and runs postmap', async () => {
		const fixture = await createFixture('# aliases\n');
		let postmapCalls = 0;
		const before = await stat(fixture.aliasFilePath);
		const result = await fixture
			.service(async () => postmapCalls++)
			.create({
				address: 'contact@zasoque.org',
				destination: 'jeonhangyeol@zasoque.org'
			});
		expect(result).toEqual({
			address: 'contact@zasoque.org',
			destination: 'jeonhangyeol@zasoque.org',
			created: true
		});
		expect(await readFile(fixture.aliasFilePath, 'utf8')).toBe(
			'# aliases\ncontact@zasoque.org\tjeonhangyeol@zasoque.org\n'
		);
		expect(postmapCalls).toBe(1);
		const after = await stat(fixture.aliasFilePath);
		expect(after.ino).not.toBe(before.ino);
		expect(after.mode & 0o7777).toBe(before.mode & 0o7777);
		expect(after.uid).toBe(before.uid);
		expect(after.gid).toBe(before.gid);
		expect(
			(await readdir(fixture.backupDirectoryPath)).filter((name) => name.endsWith('.bak'))
		).toHaveLength(1);
		expect(
			(await readdir(fixture.root)).filter((name) => name.endsWith('.bak') || name.endsWith('.tmp'))
		).toHaveLength(0);
	});

	test('rejects a symlink source during preflight', async () => {
		const fixture = await createFixture('');
		await rm(fixture.aliasFilePath);
		await symlink(fixture.usersFilePath, fixture.aliasFilePath);
		await expect(fixture.service().verifyMutationAccess()).rejects.toThrow(
			/owner-only regular file/
		);
	});

	test('rejects an unsafe writable source directory during preflight', async () => {
		const fixture = await createFixture('');
		await chmod(fixture.root, 0o777);
		await expect(fixture.service().verifyMutationAccess()).rejects.toThrow(/directory is unsafe/);
	});

	test('serializes concurrent mutations', async () => {
		const fixture = await createFixture('');
		const service = fixture.service(async () => {
			await Bun.sleep(10);
		});
		await Promise.all([
			service.create({ address: 'one@zasoque.org', destination: 'jeonhangyeol@zasoque.org' }),
			service.create({ address: 'two@zasoque.org', destination: 'another@zasoque.org' })
		]);
		const contents = await readFile(fixture.aliasFilePath, 'utf8');
		expect(contents).toContain('one@zasoque.org');
		expect(contents).toContain('two@zasoque.org');
	});

	test('updates a destination and deletes an alias', async () => {
		const fixture = await createFixture(
			'admin@zasoque.org\tjeonhangyeol@zasoque.org\ncontact@zasoque.org\tjeonhangyeol@zasoque.org\n',
			'jeonhangyeol@zasoque.org:{CRYPT}x\nanother@zasoque.org:{CRYPT}y\n'
		);
		await fixture.service().update('contact@zasoque.org', {
			destination: 'another@zasoque.org'
		});
		expect(await readFile(fixture.aliasFilePath, 'utf8')).toContain(
			'contact@zasoque.org\tanother@zasoque.org'
		);
		await fixture.service().delete('contact@zasoque.org');
		expect(await readFile(fixture.aliasFilePath, 'utf8')).toBe(
			'admin@zasoque.org\tjeonhangyeol@zasoque.org\n'
		);
	});

	test('rejects mailbox conflicts, missing destinations, duplicates, and self aliases', async () => {
		const fixture = await createFixture('admin@zasoque.org jeonhangyeol@zasoque.org\n');
		const service = fixture.service();
		await expect(
			service.create({
				address: 'jeonhangyeol@zasoque.org',
				destination: 'another@zasoque.org'
			})
		).rejects.toMatchObject({ code: 'account_address_conflict' });
		await expect(
			service.create({ address: 'contact@zasoque.org', destination: 'missing@zasoque.org' })
		).rejects.toMatchObject({ code: 'destination_not_found' });
		await expect(
			service.create({ address: 'admin@zasoque.org', destination: 'another@zasoque.org' })
		).rejects.toMatchObject({ code: 'alias_exists' });
		await expect(
			service.create({ address: 'loop@zasoque.org', destination: 'loop@zasoque.org' })
		).rejects.toMatchObject({ code: 'invalid_request' });
	});

	test('restores the source and rebuilds the old map when postmap fails', async () => {
		const original = 'admin@zasoque.org jeonhangyeol@zasoque.org\n';
		const fixture = await createFixture(original);
		let calls = 0;
		const service = fixture.service(async () => {
			calls += 1;
			if (calls === 1) throw new Error('simulated postmap failure');
		});
		await expect(
			service.create({
				address: 'contact@zasoque.org',
				destination: 'jeonhangyeol@zasoque.org'
			})
		).rejects.toMatchObject({ code: 'postmap_failed' });
		expect(await readFile(fixture.aliasFilePath, 'utf8')).toBe(original);
		expect(calls).toBe(2);
	});
});

async function createFixture(
	aliases = '',
	users = 'jeonhangyeol@zasoque.org:{CRYPT}x\nanother@zasoque.org:{CRYPT}y\n'
) {
	const root = await mkdtemp(path.join(tmpdir(), 'alias-service-test-'));
	temporaryDirectories.push(root);
	const aliasFilePath = path.join(root, 'virtual_alias');
	const usersFilePath = path.join(root, 'users');
	const backupDirectoryPath = path.join(root, 'backups');
	await writeFile(aliasFilePath, aliases, { mode: 0o600 });
	await writeFile(usersFilePath, users, { mode: 0o600 });
	await mkdir(backupDirectoryPath, { mode: 0o700 });
	return {
		root,
		aliasFilePath,
		usersFilePath,
		backupDirectoryPath,
		service: (runPostmap: () => Promise<void> = async () => undefined) =>
			new AliasService(
				{ aliasFilePath, usersFilePath, postmapPath: '/unused', backupDirectoryPath },
				{ runPostmap }
			)
	};
}
