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
	/** Also create a short link; without a code, the server picks a random one */
	link?: ShortLinkRequest;
}

export interface ShortLinkRequest {
	/** The link secret; a short link is the one place the server gets to hold it */
	secret: string;
	code?: string;
}

/** A live short link. It works once, and only until it expires. */
export interface ShortLink {
	code: string;
	createdAt: string;
	expiresAt: string;
}

/** The link to a message. The secret stays in the fragment, which browsers never send to the server. */
export const shareUrl = (origin: string, id: string, secret: string) => `${origin}/v/${id}#${secret}`;

/** Short links live at the site root, e.g. https://burnit.example.com/test */
export const shortUrl = (origin: string, code: string) => `${origin}/${code}`;

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

	create(request: CreateMessageRequest): Promise<{ id: string; link?: ShortLink }> {
		return firstValueFrom(this.http.post<{ id: string; link?: ShortLink }>(this.apiUrl, request));
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

	/** Trades a short link for the full one. This uses the short link up. */
	resolveLink(code: string): Promise<{ id: string; secret: string }> {
		return firstValueFrom(this.http.post<{ id: string; secret: string }>(`/api/links/${encodeURIComponent(code)}`, {}));
	}

	private messageUrl(id: string): string {
		return `${this.apiUrl}/${encodeURIComponent(id)}`;
	}
}
