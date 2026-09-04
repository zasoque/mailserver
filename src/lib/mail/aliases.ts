export interface VirtualAlias {
	address: string;
	destination: string;
	sendAsAllowed?: true;
}

export interface AliasesApiResponse {
	aliases: VirtualAlias[];
}

export interface CreateAliasRequest extends VirtualAlias {}

export interface UpdateAliasRequest {
	destination: string;
}

export interface AliasMutationResponse extends VirtualAlias {
	created?: true;
	updated?: true;
	deleted?: true;
}

const ZASOQUE_ADDRESS_PATTERN = /^[a-z0-9._-]{1,64}@zasoque\.org$/;

export function isValidAliasAddress(value: unknown): value is string {
	return typeof value === 'string' && ZASOQUE_ADDRESS_PATTERN.test(value);
}
