import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom } from "rxjs";

export interface CreateMessageRequest {
	ciphertext: string;
	authHash: string;
	usePassword: boolean;
	nocopy: boolean;
	maxViews: number;
	/** Seconds from now */
	expiresIn: number;
	/** The owner's sealed copy of the key, when signed in with an unlocked vault */
	ownerBlob?: string;
	/** Also create a short link; without an alias, the shortener picks a random one */
	link?: ShortLinkRequest;
}

export interface ShortLinkRequest {
	/** The link secret. The short link leads to the full link, so the shortener holds it until the link is gone. */
	secret: string;
	alias?: string;
}

/** A live short link at the external shortener (byh.uy) */
export interface ShortLink {
	id: string;
	url: string;
	/** Whether the shortener stops it after one click */
	singleUse: boolean;
	createdAt: string;
	expiresAt: string;
}

export interface CreatedMessage {
	id: string;
	link?: ShortLink;
	/** Set when the message was saved but its short link couldn't be made */
	linkError?: ApiErrorBody;
}

/** The link to a message. The secret stays in the fragment, which browsers never send to the server. */
export const shareUrl = (origin: string, id: string, secret: string) => `${origin}/v/${id}#${secret}`;

export interface MessageMetadata {
	usePassword: boolean;
	nocopy: boolean;
	maxViews: number;
	views: number;
	expiresAt: string;
}

export interface OpenedMessage extends MessageMetadata {
	ciphertext: string;
	burned: boolean;
}

export interface ApiErrorBody {
	error: string;
	type: string;
}

/** Extracts the server's error body, or a generic one for network failures. */
export function apiError(error: unknown): ApiErrorBody & { status: number } {
	if (error instanceof HttpErrorResponse && error.error && typeof error.error.type === "string") {
		return { ...(error.error as ApiErrorBody), status: error.status };
	}
	return {
		error: "Unable to reach the server. Please try again.",
		type: "network_error",
		status: error instanceof HttpErrorResponse ? error.status : 0,
	};
}

@Injectable({ providedIn: "root" })
export class MessageService {
	private readonly http = inject(HttpClient);
	private readonly apiUrl = "/api/messages";

	create(request: CreateMessageRequest): Promise<CreatedMessage> {
		return firstValueFrom(this.http.post<CreatedMessage>(this.apiUrl, request));
	}

	getMetadata(id: string): Promise<MessageMetadata> {
		return firstValueFrom(this.http.get<MessageMetadata>(this.messageUrl(id)));
	}

	open(id: string, authToken: string): Promise<OpenedMessage> {
		return firstValueFrom(this.http.post<OpenedMessage>(`${this.messageUrl(id)}/open`, { authToken }));
	}

	/** Adds a short link, proving knowledge of the key with the access token. */
	addLink(id: string, authToken: string, link: ShortLinkRequest): Promise<ShortLink> {
		return firstValueFrom(this.http.post<ShortLink>(`${this.messageUrl(id)}/links`, { authToken, ...link }));
	}

	private messageUrl(id: string): string {
		return `${this.apiUrl}/${encodeURIComponent(id)}`;
	}
}
