import { Injectable, computed, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, firstValueFrom } from "rxjs";
import { MessageMetadata, ShortLink } from "./message.service";
import {
	OwnerRecord,
	WrappedVault,
	createVault,
	forgetVaultKey,
	openRecord,
	recallVaultKey,
	rememberVaultKey,
	rewrapVault,
	sealRecord,
	unlockVault,
} from "../lib/vault";

export interface User {
	id: string;
	name: string;
	email: string;
	vault: WrappedVault | null;
}

interface Session {
	accounts: { enabled: boolean; provider: string };
	user: User | null;
	admin: boolean;
	shortLinks: { enabled: boolean };
}

/** The shortener settings an admin sees. The API key itself never comes back. */
export interface ShortenerStatus {
	endpoint: string;
	domainId: number | null;
	/** 0 = as long as the message */
	lifetimeMinutes: number;
	singleUse: boolean;
	providerExpiry: boolean;
	/** The OAuth app registered at the shortener (Admin ▸ Apps there) */
	oauthClient: { clientId: string; secretSet: boolean };
	/** The redirect URI to register with that app */
	redirectUri: string;
	connection: {
		method: "oauth" | "api_key" | null;
		connected: boolean;
		/** Revoked at the service, or encrypted with a different SECRET_KEY */
		needsReconnect: boolean;
		/** API key only: its first and last characters */
		hint: string;
		/** OAuth only */
		workspace: string;
		scope: string;
		tokenExpiresAt: string | null;
		refreshable: boolean;
		connectedAt: string | null;
	};
}

export type ShortenerOptions = Partial<Pick<ShortenerStatus, "endpoint" | "domainId" | "lifetimeMinutes" | "singleUse" | "providerExpiry">>;

export type BurnReason = "read" | "expired" | "attempts" | "revoked";

export interface OwnedMessage extends MessageMetadata {
	id: string;
	failedAttempts: number;
	createdAt: string;
	/** The owner record sealed with the vault key; null once burned, or if no copy was kept */
	ownerBlob: string | null;
	burnedAt: string | null;
	burnReason: BurnReason | null;
	/** Live short links, oldest first */
	links: ShortLink[];
}

export interface OwnedMessageDetail extends OwnedMessage {
	/** null once burned */
	ciphertext: string | null;
}

export interface UpdateMessageRequest {
	ciphertext?: string;
	authHash?: string;
	usePassword?: boolean;
	nocopy?: boolean;
	maxViews?: number;
	/** Seconds from now */
	expiresIn?: number;
	ownerBlob?: string | null;
}

/** "signed-out" also covers servers without accounts. */
export type VaultState = "signed-out" | "setup" | "locked" | "unlocked";

@Injectable({ providedIn: "root" })
export class AccountService {
	private readonly http = inject(HttpClient);
	private readonly apiUrl = "/api/account";

	readonly enabled = signal(false);
	readonly provider = signal("PocketID");
	readonly user = signal<User | null>(null);
	/** Whether this account may change server settings */
	readonly admin = signal(false);
	/** Whether the server can make short links (an admin connected a shortener) */
	readonly shortLinks = signal(false);
	private readonly vaultKey = signal<CryptoKey | null>(null);

	readonly vaultState = computed<VaultState>(() => {
		const user = this.user();
		if (!user) return "signed-out";
		if (!user.vault) return "setup";
		return this.vaultKey() ? "unlocked" : "locked";
	});

	/** Resolves once the session is known; failures leave the site usable without accounts. */
	readonly ready: Promise<void> = this.load();

	private async load(): Promise<void> {
		try {
			const session = await firstValueFrom(this.http.get<Session>("/api/session"));
			this.enabled.set(session.accounts.enabled);
			this.provider.set(session.accounts.provider);
			this.admin.set(session.admin);
			this.shortLinks.set(session.shortLinks.enabled);
			await this.setUser(session.user);
		} catch {
			this.enabled.set(false);
		}
	}

	loginUrl(returnTo: string): string {
		return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
	}

	async logout(): Promise<void> {
		try {
			await firstValueFrom(this.http.post(`${this.apiUrl}/logout`, {}));
		} finally {
			await this.lockVault();
			this.user.set(null);
			this.admin.set(false);
		}
	}

	async deleteAccount(): Promise<void> {
		await firstValueFrom(this.http.delete(this.apiUrl));
		await this.lockVault();
		this.user.set(null);
		this.admin.set(false);
	}

	/* ---------- Vault ---------- */

	async setupVault(passphrase: string, { reset = false } = {}): Promise<void> {
		const { wrapped, key } = await createVault(passphrase);
		await this.saveVault(wrapped, reset);
		this.vaultKey.set(key);
		await rememberVaultKey(this.user()!.id, wrapped, key);
	}

	/** Throws if the passphrase is wrong. */
	async unlockVault(passphrase: string): Promise<void> {
		const user = this.user();
		if (!user?.vault) throw new Error("No vault to unlock.");
		const key = await unlockVault(user.vault, passphrase);
		this.vaultKey.set(key);
		await rememberVaultKey(user.id, user.vault, key);
	}

	async lockVault(): Promise<void> {
		this.vaultKey.set(null);
		await forgetVaultKey();
	}

	/** Throws if the current passphrase is wrong. */
	async changePassphrase(current: string, next: string): Promise<void> {
		const user = this.user();
		if (!user?.vault) throw new Error("No vault to change.");
		const wrapped = await rewrapVault(user.vault, current, next);
		await this.saveVault(wrapped, false);
		await rememberVaultKey(user.id, wrapped, await unlockVault(wrapped, next));
	}

	/** Seals an owner record, or returns undefined while the vault is locked. */
	async seal(record: OwnerRecord): Promise<string | undefined> {
		const key = this.vaultKey();
		return key ? sealRecord(key, record) : undefined;
	}

	/** Opens an owner record, or returns null if it can't be (locked vault, no copy, or an older vault). */
	async open(blob: string | null): Promise<OwnerRecord | null> {
		const key = this.vaultKey();
		if (!key || !blob) return null;
		try {
			return await openRecord(key, blob);
		} catch {
			return null;
		}
	}

	/* ---------- Owned messages ---------- */

	list(): Promise<OwnedMessage[]> {
		return firstValueFrom(this.http.get<OwnedMessage[]>(`${this.apiUrl}/messages`));
	}

	get(id: string): Promise<OwnedMessageDetail> {
		return firstValueFrom(this.http.get<OwnedMessageDetail>(this.messageUrl(id)));
	}

	update(id: string, changes: UpdateMessageRequest): Promise<OwnedMessage> {
		return firstValueFrom(this.http.patch<OwnedMessage>(this.messageUrl(id), changes));
	}

	revoke(id: string): Promise<OwnedMessage> {
		return firstValueFrom(this.http.post<OwnedMessage>(`${this.messageUrl(id)}/revoke`, {}));
	}

	remove(id: string): Promise<unknown> {
		return firstValueFrom(this.http.delete(this.messageUrl(id)));
	}

	/** Adds a short link; without an alias, the shortener picks a random one. */
	addLink(id: string, secret: string, alias?: string): Promise<ShortLink> {
		return firstValueFrom(this.http.post<ShortLink>(`${this.messageUrl(id)}/links`, { secret, alias }));
	}

	/** Deletes one short link, or every one of the message's when `linkId` is omitted. */
	revokeLinks(id: string, linkId?: string): Promise<unknown> {
		const url = `${this.messageUrl(id)}/links`;
		return firstValueFrom(this.http.delete(linkId ? `${url}/${encodeURIComponent(linkId)}` : url));
	}

	/* ---------- Admin: link shortener ---------- */

	shortenerStatus(): Promise<ShortenerStatus> {
		return firstValueFrom(this.http.get<ShortenerStatus>(this.shortenerUrl));
	}

	updateShortener(options: ShortenerOptions): Promise<ShortenerStatus> {
		return this.trackShortener(this.http.put<ShortenerStatus>(this.shortenerUrl, options));
	}

	/** Saves the OAuth app and returns the shortener's authorize URL to send the browser to. */
	startShortenerOAuth(clientId: string, clientSecret?: string, endpoint?: string): Promise<{ authorizeUrl: string }> {
		return firstValueFrom(
			this.http.post<{ authorizeUrl: string }>(`${this.shortenerUrl}/oauth/start`, { clientId, clientSecret, endpoint })
		);
	}

	/** Fallback: verifies the API key with the service, then stores it (encrypted) on the server. */
	connectShortener(apiKey: string, endpoint?: string): Promise<ShortenerStatus> {
		return this.trackShortener(this.http.post<ShortenerStatus>(`${this.shortenerUrl}/connect`, { apiKey, endpoint }));
	}

	disconnectShortener(): Promise<ShortenerStatus> {
		return this.trackShortener(this.http.post<ShortenerStatus>(`${this.shortenerUrl}/disconnect`, {}));
	}

	testShortener(): Promise<ShortenerStatus> {
		return firstValueFrom(this.http.post<ShortenerStatus>(`${this.shortenerUrl}/test`, {}));
	}

	private readonly shortenerUrl = `${this.apiUrl}/admin/shortener`;

	private async trackShortener(request: Observable<ShortenerStatus>): Promise<ShortenerStatus> {
		const status = await firstValueFrom(request);
		this.shortLinks.set(status.connection.connected);
		return status;
	}

	private messageUrl(id: string): string {
		return `${this.apiUrl}/messages/${encodeURIComponent(id)}`;
	}

	private async saveVault(wrapped: WrappedVault, reset: boolean): Promise<void> {
		const user = await firstValueFrom(this.http.put<User>(`${this.apiUrl}/vault`, { ...wrapped, reset }));
		this.user.set(user);
	}

	private async setUser(user: User | null): Promise<void> {
		this.user.set(user);
		this.vaultKey.set(user?.vault ? await recallVaultKey(user.id, user.vault) : null);
	}
}
