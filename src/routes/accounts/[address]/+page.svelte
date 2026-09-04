<script lang="ts">
	import type { AccountsApiError, ChangePasswordResponse } from '$lib/mail/accounts';

	let { data } = $props();
	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);

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

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;
		successMessage = null;
		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}

		submitting = true;
		try {
			const response = await fetch(
				`/api/accounts/${encodeURIComponent(data.account.address)}/password`,
				{
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ password, confirmPassword })
				}
			);
			const body = (await response.json()) as ChangePasswordResponse | AccountsApiError;
			if (!response.ok) {
				errorMessage = 'error' in body ? body.error.message : 'Password change failed.';
				return;
			}
			password = '';
			confirmPassword = '';
			successMessage = 'Password changed successfully.';
		} catch {
			errorMessage = 'The server could not be reached. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>{data.account.address}</title></svelte:head>

<main>
	<a class="back" href="/accounts">← Accounts</a>
	<header>
		<p class="eyebrow">Mail account</p>
		<h1>{data.account.address}</h1>
	</header>

	<section class="details" aria-label="Account details">
		<div><span>Maildir</span><code>{data.maildir}</code></div>
		<div><span>Usage</span><strong>{formatUsage(data.account.usageBytes)}</strong></div>
	</section>

	<section class="panel">
		<h2>Change password</h2>
		<form onsubmit={changePassword}>
			<label for="new-password">New password</label>
			<input
				id="new-password"
				type="password"
				bind:value={password}
				autocomplete="new-password"
				maxlength="1024"
				required
			/>

			<label for="confirm-password">Confirm password</label>
			<input
				id="confirm-password"
				type="password"
				bind:value={confirmPassword}
				autocomplete="new-password"
				maxlength="1024"
				required
			/>

			{#if errorMessage}<p class="message error" role="alert">{errorMessage}</p>{/if}
			{#if successMessage}<p class="message success" role="status">{successMessage}</p>{/if}
			<button type="submit" disabled={submitting}
				>{submitting ? 'Changing…' : 'Change password'}</button
			>
		</form>
	</section>
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
		width: min(680px, calc(100% - 40px));
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
		margin: 0 0 5px;
		color: #6b6b67;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: clamp(2rem, 6vw, 2.75rem);
		letter-spacing: -0.04em;
	}
	.details,
	.panel {
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
	}
	.details {
		margin-bottom: 20px;
	}
	.details div {
		display: grid;
		grid-template-columns: 90px minmax(0, 1fr);
		gap: 16px;
		padding: 16px 20px;
		border-bottom: 1px solid #ecece8;
	}
	.details div:last-child {
		border-bottom: 0;
	}
	.details span {
		color: #70706b;
		font-size: 0.85rem;
	}
	.details code {
		overflow-wrap: anywhere;
		font-size: 0.83rem;
	}
	.details strong {
		font-size: 0.9rem;
	}
	.panel {
		padding: 24px;
	}
	h2 {
		margin: 0 0 22px;
		font-size: 1.15rem;
	}
	label {
		display: block;
		margin: 18px 0 8px;
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
		color: inherit;
		font: inherit;
	}
	input:focus {
		border-color: #171717;
		outline: 2px solid rgb(23 23 23 / 12%);
	}
	.message {
		margin: 18px 0 0;
		padding: 11px 12px;
		border-radius: 7px;
		font-size: 0.88rem;
	}
	.error {
		background: #fff0ed;
		color: #9c2d20;
	}
	.success {
		background: #edf8ef;
		color: #216e32;
	}
	button {
		margin-top: 22px;
		padding: 12px 17px;
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
