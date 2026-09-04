import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('virtual alias deployment scripts', () => {
	test('migration dry-run preserves old and matching new sources', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'alias-migration-test-'));
		try {
			const oldSource = path.join(root, 'old');
			const newSource = path.join(root, 'new');
			const contents = 'admin@zasoque.org jeonhangyeol@zasoque.org\n';
			await writeFile(oldSource, contents);
			await writeFile(newSource, contents);
			const process = Bun.spawn(
				['sh', path.join(import.meta.dir, 'migrate-virtual-alias-map.sh'), '--dry-run'],
				{
					env: {
						...Bun.env,
						MAILADMIN_ALLOW_NON_ROOT_TEST: '1',
						MAILADMIN_OLD_ALIAS_SOURCE: oldSource,
						MAILADMIN_NEW_ALIAS_SOURCE: newSource
					},
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);
			expect(await process.exited).toBe(0);
			expect(await readFile(oldSource, 'utf8')).toBe(contents);
			expect(await readFile(newSource, 'utf8')).toBe(contents);
		} finally {
			await rm(root, { recursive: true });
		}
	});

	test('migration refuses a differing destination before any write', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'alias-migration-test-'));
		try {
			const oldSource = path.join(root, 'old');
			const newSource = path.join(root, 'new');
			await writeFile(oldSource, 'old\n');
			await writeFile(newSource, 'different\n');
			const process = Bun.spawn(
				['sh', path.join(import.meta.dir, 'migrate-virtual-alias-map.sh'), '--dry-run'],
				{
					env: {
						...Bun.env,
						MAILADMIN_ALLOW_NON_ROOT_TEST: '1',
						MAILADMIN_OLD_ALIAS_SOURCE: oldSource,
						MAILADMIN_NEW_ALIAS_SOURCE: newSource
					},
					stdout: 'pipe',
					stderr: 'pipe'
				}
			);
			expect(await process.exited).not.toBe(0);
			expect(await readFile(newSource, 'utf8')).toBe('different\n');
		} finally {
			await rm(root, { recursive: true });
		}
	});

	test('staging only creates a source with the explicit fresh-install flag', async () => {
		const script = await readFile(path.join(import.meta.dir, 'stage-helper.sh'), 'utf8');
		expect(script).toContain('--fresh-alias-source');
		expect(script).toContain('&& [ ! -e "$alias_source" ]');
		expect(script).toContain('Preserved existing alias source');
	});
});
