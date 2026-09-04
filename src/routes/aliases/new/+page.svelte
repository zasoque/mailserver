<script lang="ts">
	import { goto } from '$app/navigation';
	import type { AccountsApiError } from '$lib/mail/accounts';
	let { data } = $props();
	let localPart = $state('');
	let destination = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	$effect(() => {
		if (destination === '' && data.accounts.length > 0) destination = data.accounts[0].address;
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;
		submitting = true;
		try {
			const response = await fetch('/api/aliases', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ address: `${localPart}@zasoque.org`, destination })
			});
			if (!response.ok) {
				const body = (await response.json()) as AccountsApiError;
				errorMessage = body.error.message;
				return;
			}
			await goto('/aliases', { invalidateAll: true });
		} catch {
			errorMessage = 'The server could not be reached.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>Add alias</title></svelte:head>
<main>
	<a class="back" href="/aliases">← Aliases</a>
	<header>
		<p class="eyebrow">Mail server</p>
		<h1>Add alias</h1>
	</header>
	<form onsubmit={submit}>
		<label for="alias">Alias</label>
		<div class="address">
			<input
				id="alias"
				bind:value={localPart}
				pattern="[a-z0-9._-]+"
				maxlength="64"
				autocomplete="off"
				spellcheck="false"
				required
			/><span>@zasoque.org</span>
		</div>
		<label for="destination">Destination</label><select
			id="destination"
			bind:value={destination}
			required
			>{#each data.accounts as account}<option value={account.address}>{account.address}</option
				>{/each}</select
		>
		{#if data.accounts.length === 0}<p class="error">
				Create a mailbox account before adding an alias.
			</p>{/if}
		{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
		<button type="submit" disabled={submitting || data.accounts.length === 0}
			>{submitting ? 'Creating…' : 'Create alias'}</button
		>
	</form>
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
		width: min(560px, calc(100% - 40px));
		margin: 0 auto;
		padding: 48px 0 72px;
	}
	.back {
		color: #686864;
		font-size: 0.9rem;
		text-decoration: none;
	}
	header {
		margin: 44px 0 28px;
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
		font-size: 2.5rem;
		letter-spacing: -0.04em;
	}
	form {
		padding: 28px;
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
	}
	label {
		display: block;
		margin: 20px 0 8px;
		font-size: 0.88rem;
		font-weight: 650;
	}
	label:first-child {
		margin-top: 0;
	}
	input,
	select {
		width: 100%;
		height: 44px;
		padding: 0 12px;
		border: 1px solid #cacac4;
		border-radius: 7px;
		background: white;
		font: inherit;
	}
	.address {
		display: flex;
		align-items: center;
		border: 1px solid #cacac4;
		border-radius: 7px;
		overflow: hidden;
	}
	.address input {
		min-width: 0;
		border: 0;
	}
	.address span {
		padding-right: 12px;
		color: #6b6b67;
		white-space: nowrap;
	}
	.error {
		padding: 11px;
		border-radius: 7px;
		background: #fff0ed;
		color: #9c2d20;
		font-size: 0.88rem;
	}
	button {
		width: 100%;
		margin-top: 24px;
		padding: 12px;
		border: 0;
		border-radius: 8px;
		background: #171717;
		color: white;
		font: inherit;
		font-weight: 650;
	}
	button:disabled {
		opacity: 0.5;
	}
</style>
