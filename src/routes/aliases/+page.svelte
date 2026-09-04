<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { AccountsApiError } from '$lib/mail/accounts';
	import type { AliasMutationResponse } from '$lib/mail/aliases';
	import { PROTECTED_ALIAS_ADDRESSES } from '$lib/mail/config';

	let { data } = $props();
	let editingAddress = $state<string | null>(null);
	let destination = $state('');
	let busyAddress = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);

	function beginEdit(address: string, currentDestination: string) {
		editingAddress = address;
		destination = currentDestination;
		errorMessage = null;
	}

	async function save(address: string) {
		busyAddress = address;
		errorMessage = null;
		try {
			const response = await fetch(`/api/aliases/${encodeURIComponent(address)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ destination })
			});
			const body = (await response.json()) as AliasMutationResponse | AccountsApiError;
			if (!response.ok) {
				errorMessage = 'error' in body ? body.error.message : 'Alias update failed.';
				return;
			}
			editingAddress = null;
			await invalidateAll();
		} catch {
			errorMessage = 'The server could not be reached.';
		} finally {
			busyAddress = null;
		}
	}

	async function remove(address: string) {
		if (!confirm(`Delete alias ${address}?`)) return;
		busyAddress = address;
		errorMessage = null;
		try {
			const response = await fetch(`/api/aliases/${encodeURIComponent(address)}`, {
				method: 'DELETE'
			});
			const body = (await response.json()) as AliasMutationResponse | AccountsApiError;
			if (!response.ok) {
				errorMessage = 'error' in body ? body.error.message : 'Alias deletion failed.';
				return;
			}
			await invalidateAll();
		} catch {
			errorMessage = 'The server could not be reached.';
		} finally {
			busyAddress = null;
		}
	}

	function isProtected(address: string) {
		return (PROTECTED_ALIAS_ADDRESSES as readonly string[]).includes(address);
	}
</script>

<svelte:head><title>Aliases</title></svelte:head>
<main>
	<nav><a href="/accounts">Accounts</a><a class="active" href="/aliases">Aliases</a></nav>
	<header>
		<div>
			<p class="eyebrow">Mail server</p>
			<h1>Aliases</h1>
		</div>
		<a class="button" href="/aliases/new">Add alias</a>
	</header>
	{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
	{#if data.aliases.length === 0}
		<section class="empty">
			<h2>No aliases yet</h2>
			<p>Add an alias that delivers to an existing mailbox.</p>
		</section>
	{:else}
		<div class="table-wrap">
			<table>
				<thead
					><tr><th>Alias</th><th>Destination</th><th><span class="sr-only">Actions</span></th></tr
					></thead
				>
				<tbody
					>{#each data.aliases as alias}
						<tr
							><td><strong>{alias.address}</strong></td><td>
								{#if editingAddress === alias.address}
									<select bind:value={destination} aria-label={`Destination for ${alias.address}`}>
										{#each data.accounts as account}<option value={account.address}
												>{account.address}</option
											>{/each}
									</select>
								{:else}<span>{alias.destination}</span>{/if}
							</td><td class="actions">
								{#if editingAddress === alias.address}
									<button
										disabled={busyAddress === alias.address}
										onclick={() => save(alias.address)}>Save</button
									>
									<button class="quiet" onclick={() => (editingAddress = null)}>Cancel</button>
								{:else}
									<button class="quiet" onclick={() => beginEdit(alias.address, alias.destination)}
										>Edit</button
									>
									{#if !isProtected(alias.address)}<button
											class="delete"
											disabled={busyAddress === alias.address}
											onclick={() => remove(alias.address)}>Delete</button
										>{/if}
								{/if}
							</td></tr
						>
					{/each}</tbody
				>
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
		width: min(1040px, calc(100% - 40px));
		margin: 0 auto;
		padding: 44px 0 72px;
	}
	nav {
		display: flex;
		gap: 22px;
		margin-bottom: 42px;
		border-bottom: 1px solid #deded9;
	}
	nav a {
		padding: 0 2px 12px;
		color: #6b6b67;
		text-decoration: none;
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
		gap: 24px;
		margin-bottom: 28px;
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
	.button {
		padding: 11px 17px;
		border-radius: 8px;
		background: #171717;
		color: white;
		font-weight: 650;
		text-decoration: none;
	}
	.table-wrap,
	.empty {
		overflow: hidden;
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0/4%);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 15px 18px;
		border-bottom: 1px solid #ecece8;
		text-align: left;
	}
	th {
		color: #6b6b67;
		background: #fafaf8;
		font-size: 0.78rem;
		text-transform: uppercase;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	td.actions {
		text-align: right;
		white-space: nowrap;
	}
	select {
		width: 100%;
		padding: 8px;
		border: 1px solid #cacac4;
		border-radius: 7px;
		background: white;
		font: inherit;
	}
	button {
		padding: 8px 11px;
		border: 0;
		border-radius: 7px;
		background: #171717;
		color: white;
		font: inherit;
		cursor: pointer;
	}
	.quiet {
		background: transparent;
		color: #555;
	}
	.delete {
		background: transparent;
		color: #ad2419;
	}
	.error {
		padding: 12px;
		border-radius: 8px;
		background: #fff0ed;
		color: #9c2d20;
	}
	.empty {
		padding: 28px;
	}
	.empty h2 {
		margin: 0 0 8px;
	}
	.empty p {
		margin: 0;
		color: #686864;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}
	@media (max-width: 680px) {
		main {
			width: calc(100% - 24px);
		}
		th,
		td {
			padding: 12px 10px;
		}
		.actions button {
			display: block;
			width: 100%;
			margin: 2px 0;
		}
	}
</style>
