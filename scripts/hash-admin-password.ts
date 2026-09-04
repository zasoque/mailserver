import { hash } from 'bcryptjs';

async function main(): Promise<void> {
	if (!process.stdin.isTTY || !process.stderr.isTTY || !process.stdin.setRawMode) {
		throw new Error('This command must be run interactively in a terminal.');
	}

	const password = await readHidden('Password: ');
	const confirmation = await readHidden('Confirm password: ');
	if (password !== confirmation) throw new Error('Passwords do not match.');
	if (password.length < 1 || password.length > 1024 || /[\0\r\n]/.test(password)) {
		throw new Error('Password must be 1–1024 characters without NUL or line breaks.');
	}

	process.stdout.write(`${await hash(password, 12)}\n`);
}

function readHidden(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let value = '';
		let escapeSequence = false;
		const previousRawMode = process.stdin.isRaw;

		const cleanup = () => {
			process.stdin.off('data', onData);
			process.stdin.setRawMode(previousRawMode);
			process.stdin.pause();
		};

		const finish = () => {
			cleanup();
			process.stderr.write('\n');
			resolve(value);
		};

		const onData = (chunk: Buffer | string) => {
			for (const character of Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk) {
				if (escapeSequence) {
					if (/[A-Za-z~]/.test(character)) escapeSequence = false;
					continue;
				}
				if (character === '\u001b') {
					escapeSequence = true;
					continue;
				}
				if (character === '\r' || character === '\n') {
					finish();
					return;
				}
				if (character === '\u0003' || character === '\u0004') {
					cleanup();
					process.stderr.write('\n');
					reject(new Error('Password hash generation cancelled.'));
					return;
				}
				if (character === '\u007f' || character === '\b') {
					value = Array.from(value).slice(0, -1).join('');
					continue;
				}
				if (character >= ' ') value += character;
			}
		};

		process.stderr.write(prompt);
		process.stdin.setEncoding('utf8');
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on('data', onData);
	});
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : 'Password hash generation failed.';
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
});
