<script lang="ts">
	import { goto } from '$app/navigation';
	import type { AccountsApiError, CreateAccountResponse } from '$lib/mail/accounts';

	let username = $state('');
	let password = $state('');
	let passwordConfirmation = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;
		if (password !== passwordConfirmation) {
			errorMessage = 'Passwords do not match.';
			return;
		}

		submitting = true;
		try {
			const response = await fetch('/api/accounts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, domain: 'zasoque.org', password })
			});
			const body = (await response.json()) as CreateAccountResponse | AccountsApiError;
			if (!response.ok) {
				errorMessage = 'error' in body ? body.error.message : 'Account creation failed.';
				return;
			}
			await goto('/accounts', { invalidateAll: true });
		} catch {
			errorMessage = 'The server could not be reached. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>New mail account</title></svelte:head>

<main>
	<a class="back" href="/accounts">← Accounts</a>
	<div class="heading">
		<p class="eyebrow">Mail server</p>
		<h1>New account</h1>
		<p>Create a mailbox on zasoque.org.</p>
	</div>

	<form onsubmit={submit}>
		<label for="username">Username</label>
		<div class="address-field">
			<input
				id="username"
				name="username"
				bind:value={username}
				pattern="[a-z0-9._-]+"
				maxlength="64"
				autocapitalize="none"
				autocomplete="username"
				spellcheck="false"
				required
			/>
			<span>@zasoque.org</span>
		</div>
		<p class="help">Lowercase letters, numbers, dots, underscores, and hyphens only.</p>

		<label for="password">Password</label>
		<input
			id="password"
			type="password"
			bind:value={password}
			autocomplete="new-password"
			maxlength="1024"
			required
		/>

		<label for="password-confirmation">Confirm password</label>
		<input
			id="password-confirmation"
			type="password"
			bind:value={passwordConfirmation}
			autocomplete="new-password"
			maxlength="1024"
			required
		/>

		{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
		<button type="submit" disabled={submitting}
			>{submitting ? 'Creating…' : 'Create account'}</button
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
	.heading {
		margin: 44px 0 28px;
	}
	.eyebrow {
		margin: 0 0 5px;
		color: #6b6b67;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-size: 2.5rem;
		letter-spacing: -0.04em;
	}
	.heading > p:last-child {
		margin: 10px 0 0;
		color: #686864;
	}
	form {
		padding: 28px;
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
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
	input {
		width: 100%;
		height: 44px;
		padding: 0 12px;
		border: 1px solid #cacac4;
		border-radius: 7px;
		background: white;
		color: inherit;
		font: inherit;
	}
	input:focus {
		border-color: #171717;
		outline: 2px solid rgb(23 23 23 / 12%);
	}
	.address-field {
		display: flex;
		align-items: center;
		border: 1px solid #cacac4;
		border-radius: 7px;
		overflow: hidden;
	}
	.address-field:focus-within {
		border-color: #171717;
		outline: 2px solid rgb(23 23 23 / 12%);
	}
	.address-field input {
		min-width: 0;
		border: 0;
		border-radius: 0;
		outline: 0;
	}
	.address-field span {
		padding-right: 12px;
		color: #6b6b67;
		white-space: nowrap;
	}
	.help {
		margin: 7px 0 0;
		color: #7a7a75;
		font-size: 0.78rem;
	}
	.error {
		margin: 20px 0 0;
		padding: 11px 12px;
		border-radius: 7px;
		background: #fff0ed;
		color: #9c2d20;
		font-size: 0.88rem;
		line-height: 1.4;
	}
	button {
		width: 100%;
		margin-top: 24px;
		padding: 12px 16px;
		border: 0;
		border-radius: 8px;
		background: #171717;
		color: white;
		font: inherit;
		font-weight: 650;
		cursor: pointer;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
</style>
