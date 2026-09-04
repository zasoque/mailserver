import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import type { MailServerStatus, ServiceState } from '../src/lib/mail/status';
import type { AccountReader } from './account-reader';
import type { AliasService } from './alias-service';
import type { DeletedAccountService } from './deleted-account-service';

export interface StatusServiceOptions {
	postqueuePath: string;
	probeTimeoutMs?: number;
}

export interface StatusServiceDependencies {
	probe?: (host: string, port: number, timeoutMs: number) => Promise<ServiceState>;
	queueCount?: () => Promise<number>;
}

const SERVICE_PORTS = {
	smtp: 25,
	submission: 587,
	imaps: 993,
	dkim: 10027
} as const;

export class StatusService {
	private readonly probe: (host: string, port: number, timeoutMs: number) => Promise<ServiceState>;
	private readonly queueCount: () => Promise<number>;

	constructor(
		private readonly accountReader: AccountReader,
		private readonly aliasService: AliasService,
		private readonly deletedAccountService: DeletedAccountService,
		private readonly options: StatusServiceOptions,
		dependencies: StatusServiceDependencies = {}
	) {
		this.probe = dependencies.probe ?? probeTcp;
		this.queueCount = dependencies.queueCount ?? (() => countPostfixQueue(options.postqueuePath));
	}

	async get(): Promise<MailServerStatus> {
		const timeout = this.options.probeTimeoutMs ?? 500;
		const [smtp, submission, imaps, dkim, accounts, aliases, deleted, queue] = await Promise.all([
			this.safeProbe(SERVICE_PORTS.smtp, timeout),
			this.safeProbe(SERVICE_PORTS.submission, timeout),
			this.safeProbe(SERVICE_PORTS.imaps, timeout),
			this.safeProbe(SERVICE_PORTS.dkim, timeout),
			settle(() => this.accountReader.list()),
			settle(() => this.aliasService.list()),
			settle(() => this.deletedAccountService.list()),
			settle(() => this.queueCount())
		]);

		return {
			services: {
				smtp: { status: smtp },
				submission: { status: submission },
				imaps: { status: imaps },
				dkim: { status: dkim }
			},
			accounts: accounts?.accounts.length ?? null,
			aliases: aliases?.aliases.length ?? null,
			deletedAccounts: deleted?.archives.length ?? null,
			mailStorageBytes: sumKnown(accounts?.accounts.map((account) => account.usageBytes)),
			deletedMailBytes: sumKnown(deleted?.archives.map((archive) => archive.usageBytes)),
			queue: { messages: queue }
		};
	}

	private async safeProbe(port: number, timeout: number): Promise<ServiceState> {
		try {
			return await this.probe('127.0.0.1', port, timeout);
		} catch {
			return 'unavailable';
		}
	}
}

function sumKnown(values: Array<number | null> | undefined): number | null {
	if (values === undefined || values.some((value) => value === null)) return null;
	return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

async function settle<T>(operation: () => Promise<T>): Promise<T | null> {
	try {
		return await operation();
	} catch {
		return null;
	}
}

async function probeTcp(host: string, port: number, timeoutMs: number): Promise<ServiceState> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		let settled = false;
		const finish = (status: ServiceState) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(status);
		};
		socket.setTimeout(timeoutMs);
		socket.once('connect', () => finish('running'));
		socket.once('timeout', () => finish('down'));
		socket.once('error', () => finish('down'));
	});
}

async function countPostfixQueue(postqueuePath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(postqueuePath, ['-j'], {
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' }
		});
		let stdout = '';
		let stderr = '';
		let stdoutOverflow = false;
		let settled = false;
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			if (!settled) {
				settled = true;
				reject(new Error('postqueue timed out.'));
			}
		}, 2_000);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			if (stdout.length + chunk.length > 4 * 1024 * 1024) stdoutOverflow = true;
			else stdout += chunk;
		});
		child.stderr.on('data', (chunk: string) => {
			if (stderr.length < 8192) stderr += chunk;
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
		child.once('close', (code) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			if (code !== 0) {
				reject(new Error(`postqueue exited with code ${code}: ${stderr.slice(0, 2048)}`));
				return;
			}
			if (stdoutOverflow) {
				reject(new Error('postqueue output exceeded the safety limit.'));
				return;
			}
			const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
			try {
				for (const line of lines) JSON.parse(line);
				resolve(lines.length);
			} catch (error) {
				reject(new Error('postqueue returned invalid JSON.', { cause: error }));
			}
		});
	});
}
