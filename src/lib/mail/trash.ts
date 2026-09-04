export interface TrashStatus {
	mailbox: 'Trash';
	exists: boolean;
	messages: number;
	bytes: number;
}

export interface EmptyTrashRequest {
	confirmed: true;
}

export interface EmptyTrashResponse extends TrashStatus {
	address: string;
	emptied: true;
}
