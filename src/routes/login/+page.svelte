<script lang="ts">
	import { goto } from '$app/navigation';

	let username = $state('');
	let password = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	async function login(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;
		submitting = true;
		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			if (!response.ok) {
				password = '';
				errorMessage = 'Invalid username or password.';
				return;
			}
			password = '';
			await goto('/dashboard', { invalidateAll: true });
		} catch {
			errorMessage = 'The server could not be reached. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head><title>Log in — Zasoque Mail Admin</title></svelte:head>

<main>
	<div class="heading">
		<p class="eyebrow">Zasoque Mail Admin</p>
		<h1>Log in</h1>
	</div>
	<form onsubmit={login}>
		<label for="username">Username</label>
		<input id="username" bind:value={username} autocomplete="username" maxlength="64" required />
		<label for="password">Password</label>
		<input
			id="password"
			type="password"
			bind:value={password}
			autocomplete="current-password"
			maxlength="1024"
			required
		/>
		{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
		<button type="submit" disabled={submitting}>{submitting ? 'Logging in…' : 'Log in'}</button>
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
		width: min(440px, calc(100% - 40px));
		margin: 0 auto;
		padding: 12vh 0 64px;
	}
	.heading {
		margin-bottom: 28px;
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
		color: inherit;
		font: inherit;
	}
	input:focus {
		border-color: #171717;
		outline: 2px solid rgb(23 23 23 / 12%);
	}
	.error {
		margin: 18px 0 0;
		padding: 11px 12px;
		border-radius: 7px;
		background: #fff0ed;
		color: #9c2d20;
		font-size: 0.88rem;
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
