import { hash } from 'bcryptjs';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const password = Buffer.concat(chunks)
	.toString('utf8')
	.replace(/\r?\n$/, '');
if (password.length < 1 || password.length > 1024 || /[\0\r\n]/.test(password)) {
	throw new Error('Password must be 1–1024 characters without NUL or line breaks.');
}
process.stdout.write(`${await hash(password, 12)}\n`);
