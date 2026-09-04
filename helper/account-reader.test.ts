import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AccountReader } from './account-reader';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

test('lists addresses and Maildir usage without returning password hashes', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'mail-reader-test-'));
	temporaryDirectories.push(root);
	const usersFile = path.join(root, 'users');
	const vmailRoot = path.join(root, 'vmail');
	const messageDirectory = path.join(vmailRoot, 'zasoque.org', 'toku', 'Maildir', 'cur');
	await mkdir(messageDirectory, { recursive: true });
	await writeFile(path.join(messageDirectory, 'message'), '12345');
	await writeFile(
		usersFile,
		'# comment\ntoku@zasoque.org:{CRYPT}$2y$secret\nother@zasoque.org:{CRYPT}$2y$other\n'
	);

	const result = await new AccountReader(usersFile, vmailRoot).list();

	expect(result).toEqual({
		accounts: [
			{ address: 'other@zasoque.org', usageBytes: null },
			{ address: 'toku@zasoque.org', usageBytes: 5 }
		]
	});
	expect(JSON.stringify(result)).not.toContain('$2y$');
});
