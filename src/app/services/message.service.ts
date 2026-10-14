import { Injectable, inject } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom } from "rxjs";

export interface CreateMessageRequest {
	alias?: string;
	ciphertext: string;
	authHash: string;
	usePassword: boolean;
	nocopy: boolean;
	maxViews: number;
	/** Seconds from now */
	expiresIn: number;
	/** The owner's sealed copy of the key, when signed in with an unlocked vault */
	ownerBlob?: string;
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
	attemptsLeft?: number;
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

	create(request: CreateMessageRequest): Promise<{ id: string }> {
		return firstValueFrom(this.http.post<{ id: string }>(this.apiUrl, request));
	}

	getMetadata(id: string): Promise<MessageMetadata> {
		return firstValueFrom(this.http.get<MessageMetadata>(`${this.apiUrl}/${encodeURIComponent(id)}`));
	}

	open(id: string, authToken: string): Promise<OpenedMessage> {
		return firstValueFrom(
			this.http.post<OpenedMessage>(`${this.apiUrl}/${encodeURIComponent(id)}/open`, { authToken })
		);
	}
}
