<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { AccountsApiError } from '$lib/mail/accounts';
	let { data } = $props();
	let restoring = $state<string | null>(null),
		deleting = $state<string | null>(null),
		busy = $state(false),
		errorMessage = $state<string | null>(null);
	let password = $state(''),
		confirmPassword = $state(''),
		confirmation = $state('');

	function bytes(value: number | null) {
		return value === null ? 'Unavailable' : value === 0 ? '0 MB' : `${(value / 1e6).toFixed(1)} MB`;
	}
	function reset() {
		restoring = null;
		deleting = null;
		password = '';
		confirmPassword = '';
		confirmation = '';
		errorMessage = null;
	}
	async function restore(id: string) {
		busy = true;
		errorMessage = null;
		try {
			const response = await fetch(`/api/deleted/${encodeURIComponent(id)}/restore`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password, confirmPassword })
			});
			const body = (await response.json()) as AccountsApiError;
			if (!response.ok) {
				errorMessage = body.error.message;
				return;
			}
			reset();
			await invalidateAll();
		} catch {
			errorMessage = 'The server could not be reached.';
		} finally {
			busy = false;
			password = '';
			confirmPassword = '';
		}
	}
	async function permanentlyDelete(id: string) {
		busy = true;
		errorMessage = null;
		try {
			const response = await fetch(`/api/deleted/${encodeURIComponent(id)}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ confirmation })
			});
			const body = (await response.json()) as AccountsApiError;
			if (!response.ok) {
				errorMessage = body.error.message;
				return;
			}
			reset();
			await invalidateAll();
		} catch {
			errorMessage = 'The server could not be reached.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Deleted accounts</title></svelte:head>
<main>
	<nav>
		<a href="/dashboard">Dashboard</a><a href="/accounts">Accounts</a><a href="/aliases">Aliases</a
		><a class="active" href="/deleted">Deleted Accounts</a>
	</nav>
	<header>
		<div>
			<p class="eyebrow">Mail server</p>
			<h1>Deleted Accounts</h1>
		</div>
	</header>
	{#if data.loadError}<section class="message error">{data.loadError}</section>
	{:else if data.archives.length === 0}<section class="message">
			<h2>No deleted accounts</h2>
			<p>Archived mailboxes will appear here.</p>
		</section>
	{:else}
		{#if errorMessage}<p class="error banner" role="alert">{errorMessage}</p>{/if}
		<section class="archives">
			{#each data.archives as archive}<article>
					<div class="summary">
						<div>
							<strong>{archive.address}</strong>
							<p>
								Deleted {new Date(archive.deletedAt).toLocaleString()} · {bytes(archive.usageBytes)}
							</p>
						</div>
						<div class="actions">
							<button
								onclick={() => {
									reset();
									restoring = archive.id;
								}}>Restore</button
							><button
								class="danger"
								onclick={() => {
									reset();
									deleting = archive.id;
								}}>Permanently delete</button
							>
						</div>
					</div>
					{#if restoring === archive.id}<form
							onsubmit={(event) => {
								event.preventDefault();
								restore(archive.id);
							}}
						>
							<h2>Restore {archive.address}</h2>
							<label
								>New password<input
									type="password"
									bind:value={password}
									autocomplete="new-password"
									required
								/></label
							><label
								>Confirm password<input
									type="password"
									bind:value={confirmPassword}
									autocomplete="new-password"
									required
								/></label
							>
							<div class="actions">
								<button disabled={busy || password !== confirmPassword}>Restore account</button
								><button type="button" class="quiet" onclick={reset}>Cancel</button>
							</div>
						</form>{/if}
					{#if deleting === archive.id}<form
							class="delete-box"
							onsubmit={(event) => {
								event.preventDefault();
								permanentlyDelete(archive.id);
							}}
						>
							<h2>Permanently delete {archive.address}?</h2>
							<p>
								This permanently deletes all archived mail for this account. This action cannot be
								undone.
							</p>
							<label
								>To confirm, type <strong>{archive.address}</strong><input
									bind:value={confirmation}
									autocomplete="off"
									required
								/></label
							>
							<div class="actions">
								<button class="danger solid" disabled={busy || confirmation !== archive.address}
									>Permanently delete</button
								><button type="button" class="quiet" onclick={reset}>Cancel</button>
							</div>
						</form>{/if}
				</article>{/each}
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
		width: min(960px, calc(100% - 40px));
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
	.eyebrow {
		margin: 0;
		color: #6b6b67;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	h1 {
		margin: 4px 0 32px;
		font-size: clamp(2rem, 5vw, 3.25rem);
		letter-spacing: -0.045em;
	}
	.archives {
		display: grid;
		gap: 12px;
	}
	.archives > article,
	.message {
		border: 1px solid #deded9;
		border-radius: 12px;
		background: white;
		box-shadow: 0 1px 2px rgb(0 0 0/4%);
	}
	.summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 20px;
	}
	.summary p {
		margin: 5px 0 0;
		color: #686864;
		font-size: 0.9rem;
	}
	.actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	button {
		padding: 9px 12px;
		border: 0;
		border-radius: 7px;
		background: #171717;
		color: white;
		font: inherit;
		cursor: pointer;
	}
	.danger {
		background: transparent;
		color: #ad2419;
	}
	.danger.solid {
		background: #ad2419;
		color: white;
	}
	.quiet {
		background: transparent;
		color: #555;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	form {
		padding: 20px;
		border-top: 1px solid #ecece8;
		background: #fafaf8;
	}
	form h2 {
		margin: 0 0 16px;
		font-size: 1.05rem;
	}
	form p {
		color: #5f5f5b;
		line-height: 1.5;
	}
	label {
		display: block;
		margin: 12px 0;
		font-size: 0.9rem;
		font-weight: 600;
	}
	input {
		display: block;
		width: 100%;
		max-width: 440px;
		margin-top: 7px;
		padding: 10px;
		border: 1px solid #cacac4;
		border-radius: 7px;
		font: inherit;
	}
	.message {
		padding: 28px;
	}
	.message h2 {
		margin: 0 0 8px;
	}
	.message p {
		margin: 0;
		color: #686864;
	}
	.error {
		color: #9c2d20;
	}
	.banner {
		padding: 12px;
		border-radius: 8px;
		background: #fff0ed;
	}
	@media (max-width: 680px) {
		.summary {
			align-items: flex-start;
			flex-direction: column;
		}
		.actions {
			flex-wrap: wrap;
		}
	}
</style>
