export interface Message {
	content?: string;
	expiresAt?: Date;
	maxViews: number;
	usePassword: boolean;
	views: number;
	alias?: string;
	nocopy: boolean;
	password: string;
}
