<script lang="ts">
	import { goto } from '$app/navigation';
	import type {
		AccountsApiError,
		ChangePasswordResponse,
		DeleteAccountResponse
	} from '$lib/mail/accounts';
	import { PROTECTED_ACCOUNT_ADDRESSES } from '$lib/mail/config';

	let { data } = $props();
	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let confirmingDelete = $state(false);
	let deleteConfirmation = $state('');
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	const isProtected = $derived(
		(PROTECTED_ACCOUNT_ADDRESSES as readonly string[]).includes(data.account.address)
	);

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

	function closeConfirmation() {
		if (deleting) return;
		confirmingDelete = false;
		deleteConfirmation = '';
		deleteError = null;
	}

	async function deleteAccount() {
		if (deleteConfirmation !== data.account.address || deleting || isProtected) return;
		deleteError = null;
		deleting = true;
		try {
			const response = await fetch(`/api/accounts/${encodeURIComponent(data.account.address)}`, {
				method: 'DELETE'
			});
			const body = (await response.json()) as DeleteAccountResponse | AccountsApiError;
			if (!response.ok) {
				deleteError = 'error' in body ? body.error.message : 'Account deletion failed.';
				return;
			}
			const result = body as DeleteAccountResponse;
			await goto(
				`/accounts?deleted=${encodeURIComponent(result.address)}&archived=${result.mailboxArchived ? '1' : '0'}`,
				{ invalidateAll: true }
			);
		} catch {
			deleteError = 'The server could not be reached. Please try again.';
		} finally {
			deleting = false;
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
	<section class="danger-zone">
		<div>
			<h2>Danger zone</h2>
			<h3>Delete account</h3>
			{#if isProtected}<p>This account is protected and cannot be deleted.</p>
			{:else}<p>
					This account will no longer be able to send or receive mail. Existing mailbox data will be
					archived and will not be permanently deleted.
				</p>{/if}
		</div>
		{#if !isProtected}<button
				class="delete-button"
				type="button"
				onclick={() => (confirmingDelete = true)}>Delete account</button
			>{/if}
	</section>
</main>

{#if confirmingDelete}
	<div class="modal-backdrop" role="presentation">
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
			<h2 id="delete-title">Delete {data.account.address}?</h2>
			<p>The account will immediately stop working. Existing mailbox data will be archived.</p>
			<label for="delete-confirmation"
				>To confirm, type <strong>{data.account.address}</strong></label
			>
			<input
				id="delete-confirmation"
				bind:value={deleteConfirmation}
				autocomplete="off"
				spellcheck="false"
			/>
			{#if deleteError}<p class="message error" role="alert">{deleteError}</p>{/if}
			<div class="modal-actions">
				<button class="cancel-button" type="button" disabled={deleting} onclick={closeConfirmation}
					>Cancel</button
				>
				<button
					class="delete-button"
					type="button"
					disabled={deleteConfirmation !== data.account.address || deleting}
					onclick={deleteAccount}>{deleting ? 'Deleting…' : 'Delete account'}</button
				>
			</div>
		</div>
	</div>
{/if}

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
	.panel,
	.danger-zone {
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
	.danger-zone {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-top: 36px;
		padding: 24px;
		border-color: #e5b9b1;
	}
	.danger-zone h2 {
		color: #a02e22;
	}
	.danger-zone h3 {
		margin: 0 0 6px;
		font-size: 0.95rem;
	}
	.danger-zone p {
		max-width: 500px;
		margin: 0;
		color: #686864;
		font-size: 0.87rem;
		line-height: 1.5;
	}
	.delete-button {
		flex: none;
		background: #b42318;
	}
	.delete-button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 20px;
		background: rgb(0 0 0 / 48%);
	}
	.modal {
		width: min(480px, 100%);
		padding: 26px;
		border-radius: 12px;
		background: white;
		box-shadow: 0 20px 60px rgb(0 0 0 / 25%);
	}
	.modal h2 {
		overflow-wrap: anywhere;
	}
	.modal > p {
		color: #686864;
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.modal label {
		line-height: 1.5;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 22px;
	}
	.modal-actions button {
		margin-top: 0;
	}
	.cancel-button {
		border: 1px solid #cacac4;
		background: white;
		color: #171717;
	}
	@media (max-width: 560px) {
		.danger-zone {
			align-items: stretch;
			flex-direction: column;
		}
		.danger-zone .delete-button {
			width: 100%;
		}
	}
</style>
