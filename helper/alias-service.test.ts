import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
		expect(after.mode & 0o7777).toBe(before.mode & 0o7777);
		expect(after.uid).toBe(before.uid);
		expect(after.gid).toBe(before.gid);
		expect((await readdir(fixture.root)).filter((name) => name.endsWith('.bak'))).toHaveLength(1);
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
	await writeFile(aliasFilePath, aliases, { mode: 0o640 });
	await writeFile(usersFilePath, users, { mode: 0o600 });
	return {
		root,
		aliasFilePath,
		usersFilePath,
		service: (runPostmap: () => Promise<void> = async () => undefined) =>
			new AliasService({ aliasFilePath, usersFilePath, postmapPath: '/unused' }, { runPostmap })
	};
}
