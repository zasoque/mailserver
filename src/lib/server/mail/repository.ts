import { env } from '$env/dynamic/private';
import { DovecotFileAccountRepository } from './dovecot-file-account-repository';

export const mailAccountRepository = new DovecotFileAccountRepository({
	usersFilePath: env.DOVECOT_USERS_FILE ?? '/opt/homebrew/etc/dovecot/users',
	vmailRoot: env.VMAIL_ROOT ?? '/Users/Shared/vmail'
});
