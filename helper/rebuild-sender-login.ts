import { lstat, open, stat } from 'node:fs/promises';
import { SenderLoginService } from './sender-login-service';

if (process.geteuid?.() !== 0) throw new Error('Sender-login rebuild must run as root.');

const source = '/usr/local/var/zasoque-mailadmin/postfix/sender_login';
const directory = await stat('/usr/local/var/zasoque-mailadmin/postfix');
try {
	const info = await lstat(source);
	if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe sender-login source.');
} catch (error) {
	if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
	const file = await open(source, 'wx', 0o600);
	try {
		await file.chown(0, directory.gid);
		await file.chmod(0o640);
		await file.sync();
	} finally {
		await file.close();
	}
}
const sourceFile = await open(source, 'r+');
try {
	await sourceFile.chown(0, directory.gid);
	await sourceFile.chmod(0o640);
	await sourceFile.sync();
} finally {
	await sourceFile.close();
}

const service = new SenderLoginService({
	usersFilePath: '/opt/homebrew/etc/dovecot/users',
	aliasFilePath: '/usr/local/var/zasoque-mailadmin/postfix/virtual_alias',
	senderLoginFilePath: source,
	backupDirectoryPath: '/var/backups/zasoque-mailadmin/postfix',
	postmapPath: '/usr/sbin/postmap'
});
await service.rebuildFromSources();
await service.verifyMutationAccess();
console.info('Sender-login map rebuilt and verified.');
