<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	let { data } = $props();

	function amount(value: number | null): string {
		return value === null ? 'Unavailable' : value.toLocaleString('en');
	}

	function bytes(value: number | null): string {
		if (value === null) return 'Unavailable';
		if (value === 0) return '0 MB';
		return new Intl.NumberFormat('en', {
			style: 'unit',
			unit: value >= 1e9 ? 'gigabyte' : 'megabyte',
			maximumFractionDigits: 1
		}).format(value / (value >= 1e9 ? 1e9 : 1e6));
	}
</script>

<svelte:head><title>Mail server dashboard</title></svelte:head>
<main>
	<nav>
		<a class="active" href="/dashboard">Dashboard</a><a href="/accounts">Accounts</a><a
			href="/aliases">Aliases</a
		><a href="/deleted">Deleted Accounts</a>
	</nav>
	<header>
		<div>
			<p class="eyebrow">Mail server</p>
			<h1>Dashboard</h1>
		</div>
		<button onclick={() => invalidateAll()}>Refresh</button>
	</header>
	{#if data.loadError}<section class="error" role="alert">{data.loadError}</section>
	{:else if data.status}
		<h2>Mail Services</h2>
		<section class="grid services">
			{#each Object.entries(data.status.services) as [name, service]}
				<article>
					<span
						class:running={service.status === 'running'}
						class:down={service.status === 'down'}
						class="dot"
					></span>
					<div>
						<strong>{name === 'dkim' ? 'DKIM' : name[0].toUpperCase() + name.slice(1)}</strong>
						<p>{service.status[0].toUpperCase() + service.status.slice(1)}</p>
					</div>
				</article>
			{/each}
		</section>
		<h2>Mail Statistics</h2>
		<section class="grid stats">
			<a href="/accounts"><span>Accounts</span><strong>{amount(data.status.accounts)}</strong></a>
			<a href="/aliases"><span>Aliases</span><strong>{amount(data.status.aliases)}</strong></a>
			<a href="/deleted"
				><span>Deleted accounts</span><strong>{amount(data.status.deletedAccounts)}</strong></a
			>
			<article>
				<span>Stored mail</span><strong>{bytes(data.status.mailStorageBytes)}</strong>
			</article>
			<a href="/deleted"
				><span>Deleted mail</span><strong>{bytes(data.status.deletedMailBytes)}</strong></a
			>
			<article>
				<span>Queued messages</span><strong>{amount(data.status.queue.messages)}</strong>
			</article>
		</section>
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
		width: min(1040px, calc(100% - 40px));
		margin: auto;
		padding: 44px 0 72px;
	}
	nav {
		display: flex;
		gap: 22px;
		margin-bottom: 42px;
		border-bottom: 1px solid #deded9;
		overflow: auto;
	}
	nav a {
		padding: 0 2px 12px;
		color: #6b6b67;
		text-decoration: none;
		white-space: nowrap;
	}
	nav .active {
		border-bottom: 2px solid #171717;
		color: #171717;
		font-weight: 650;
	}
	header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		margin-bottom: 34px;
	}
	.eyebrow {
		margin: 0;
		color: #6b6b67;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	h1 {
		margin: 4px 0 0;
		font-size: clamp(2rem, 5vw, 3.25rem);
		letter-spacing: -0.045em;
	}
	h2 {
		margin: 32px 0 14px;
		font-size: 1rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	.grid article,
	.grid a,
	.error {
		padding: 20px;
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0/4%);
	}
	.services article {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.services p {
		margin: 4px 0 0;
		color: #686864;
		text-transform: capitalize;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #a7a7a2;
	}
	.dot.running {
		background: #2d8a43;
	}
	.dot.down {
		background: #bd3428;
	}
	.stats a,
	.stats article {
		display: flex;
		flex-direction: column;
		gap: 10px;
		color: inherit;
		text-decoration: none;
	}
	.stats span {
		color: #686864;
		font-size: 0.88rem;
	}
	.stats strong {
		font-size: 1.5rem;
	}
	.stats a:hover {
		border-color: #999;
	}
	button {
		padding: 10px 14px;
		border: 1px solid #ccc;
		border-radius: 8px;
		background: white;
		font: inherit;
		cursor: pointer;
	}
	.error {
		color: #9c2d20;
	}
</style>
