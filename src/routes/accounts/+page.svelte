<script lang="ts">
	let { data } = $props();

	const bytes = new Intl.NumberFormat('en', {
		style: 'unit',
		unit: 'megabyte',
		unitDisplay: 'short',
		maximumFractionDigits: 2
	});

	function formatUsage(value: number | null): string {
		if (value === null) return 'Unavailable';
		if (value === 0) return '0 MB';
		return bytes.format(value / 1_000_000);
	}
</script>

<svelte:head>
	<title>Mail accounts</title>
</svelte:head>

<main>
	<header>
		<div>
			<p class="eyebrow">Mail server</p>
			<h1>Accounts</h1>
		</div>
		<a class="button" href="/accounts/new">New account</a>
	</header>

	{#if data.loadError}
		<section class="error" role="alert">
			<h2>Accounts could not be loaded</h2>
			<p>{data.loadError.message}</p>
			{#if data.loadError.code === 'permission_denied'}
				<p class="hint">
					This application does not use sudo. Grant the service user read access outside the web
					application.
				</p>
			{/if}
		</section>
	{:else if data.accounts.length === 0}
		<section class="empty">
			<h2>No accounts yet</h2>
			<p>Create the first mail account to see it here.</p>
		</section>
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Email address</th><th>Maildir usage</th></tr></thead>
				<tbody>
					{#each data.accounts as account}
						<tr>
							<td
								><a href={`/accounts/${encodeURIComponent(account.address)}`}>{account.address}</a
								></td
							>
							<td class:unavailable={account.usageBytes === null}
								>{formatUsage(account.usageBytes)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #f7f7f5;
		color: #171717;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		width: min(960px, calc(100% - 40px));
		margin: 0 auto;
		padding: 64px 0;
	}
	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 32px;
	}
	h1 {
		margin: 4px 0 0;
		font-size: clamp(2rem, 5vw, 3.25rem);
		letter-spacing: -0.045em;
	}
	.eyebrow {
		margin: 0;
		color: #6b6b67;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.button {
		padding: 11px 17px;
		border-radius: 8px;
		background: #171717;
		color: white;
		font-weight: 650;
		text-decoration: none;
	}
	.table-wrap,
	.error,
	.empty {
		overflow: hidden;
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 16px 20px;
		border-bottom: 1px solid #ecece8;
		text-align: left;
	}
	th {
		color: #6b6b67;
		background: #fafaf8;
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	td:last-child,
	th:last-child {
		text-align: right;
	}
	td a {
		color: inherit;
		font-weight: 600;
		text-decoration: none;
	}
	td a:hover {
		text-decoration: underline;
	}
	.unavailable {
		color: #8b8b85;
	}
	.error,
	.empty {
		padding: 28px;
	}
	.error {
		border-color: #e7c4bd;
		background: #fff9f7;
	}
	.error h2,
	.empty h2 {
		margin: 0 0 8px;
		font-size: 1.05rem;
	}
	.error p,
	.empty p {
		margin: 0;
		color: #676763;
		line-height: 1.5;
	}
	.error .hint {
		margin-top: 10px;
		font-size: 0.9rem;
	}
	@media (max-width: 560px) {
		main {
			width: min(100% - 24px, 960px);
			padding: 32px 0;
		}
		header {
			align-items: center;
		}
		th,
		td {
			padding: 14px;
		}
	}
</style>
