import { Component, OnInit, inject, input, signal } from "@angular/core";
import { DOCUMENT, UpperCasePipe } from "@angular/common";
import { Router } from "@angular/router";
import { AccountService, BurnReason, OwnedMessage, ShortenerStatus } from "../../services/account.service";
import { ShortLink, apiError, shareUrl } from "../../services/message.service";
import { decrypt, deriveKeys, isCryptoAvailable } from "../../lib/crypto";
import { ALIAS_PATTERN, ALIAS_RULES, formatDuration } from "../../lib/message-config";
import { OwnerRecord } from "../../lib/vault";
import { LinkCard } from "../../components/link-card";

type Dialog = "none" | "detail" | "settings" | "admin";
type Confirming = "none" | "revoke" | "delete" | "revoke-links" | "reset-vault" | "delete-account" | "disconnect";

interface Row extends OwnedMessage {
	/** The decrypted owner record; null while locked, or when no key copy exists */
	record: OwnerRecord | null;
}

const MIN_PASSPHRASE_LENGTH = 8;

const STATUS: Record<BurnReason, { short: string; long: string }> = {
	read: { short: "read", long: "destroyed after its last view" },
	expired: { short: "expired", long: "destroyed when it expired" },
	// Only on messages from before wrong attempts stopped destroying anything
	attempts: { short: "wrong-pw", long: "destroyed after too many wrong passwords" },
	revoked: { short: "revoked", long: "destroyed by you" },
};

/** Error types the OAuth callback can come back with; never text from the URL itself */
const OAUTH_ERRORS: Record<string, string> = {
	access_denied: "The connection was cancelled at the link shortener.",
	invalid_state: "That connection attempt expired or was started elsewhere. Please connect again.",
	forbidden: "Only admins can connect the link shortener.",
	shortener_error: "The link shortener refused the connection. Check the client ID, secret and redirect URI, then try again.",
	default: "Connecting to the link shortener failed. Please try again.",
};

const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

@Component({
	selector: "app-account",
	imports: [UpperCasePipe, LinkCard],
	templateUrl: "./account.html",
	styleUrl: "./account.css",
	host: {
		"(document:keydown)": "onKeydown($event)",
	},
})
export class AccountPage implements OnInit {
	protected readonly account = inject(AccountService);
	private readonly router = inject(Router);
	private readonly document = inject(DOCUMENT);

	/** `?login=failed|unavailable`, set by the server when sign-in didn't work out */
	readonly login = input<string>();
	/** `?shortener=connected|<error type>`, set by the server after connecting the shortener through OAuth */
	readonly shortenerResult = input<string>(undefined, { alias: "shortener" });

	protected readonly ready = signal(false);
	protected readonly loading = signal(false);
	protected readonly busy = signal(false);
	protected readonly rows = signal<Row[]>([]);
	protected readonly error = signal("");
	protected readonly dialog = signal<Dialog>("none");
	protected readonly confirming = signal<Confirming>("none");
	protected readonly cryptoAvailable = isCryptoAvailable();

	// Vault prompts
	protected readonly passphrase = signal("");
	protected readonly passphraseConfirm = signal("");
	protected readonly vaultError = signal("");

	// Message detail
	protected readonly selected = signal<Row | null>(null);
	protected readonly content = signal<string | null>(null);
	protected readonly decrypting = signal(false);
	protected readonly detailError = signal("");
	protected readonly showPassword = signal(false);
	protected readonly linkName = signal("");

	// Settings
	protected readonly currentPassphrase = signal("");
	protected readonly newPassphrase = signal("");
	protected readonly newPassphraseConfirm = signal("");
	protected readonly settingsMessage = signal("");
	protected readonly settingsError = signal("");

	// Admin: link shortener
	protected readonly shortener = signal<ShortenerStatus | null>(null);
	protected readonly apiKey = signal("");
	protected readonly endpoint = signal("");
	protected readonly clientId = signal("");
	protected readonly clientSecret = signal("");
	/** Showing the API key form instead of OAuth */
	protected readonly useApiKey = signal(false);
	/** Showing the key prompt while already connected */
	protected readonly reconnecting = signal(false);
	protected readonly adminMessage = signal("");
	protected readonly adminError = signal("");

	protected readonly minPassphraseLength = MIN_PASSPHRASE_LENGTH;
	protected readonly dateTime = dateTime;

	async ngOnInit(): Promise<void> {
		await this.account.ready;
		this.ready.set(true);
		if (this.account.user()) await this.refresh();

		// Back from the shortener's authorize page
		const result = this.shortenerResult();
		if (result && this.account.admin()) {
			this.router.navigate([], { queryParams: { shortener: null }, queryParamsHandling: "merge", replaceUrl: true });
			await this.openAdmin();
			if (result === "connected") this.adminMessage.set("Connected to the link shortener. Short links are on.");
			else this.adminError.set(OAUTH_ERRORS[result] ?? OAUTH_ERRORS["default"]);
		}
	}

	protected onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape" && this.dialog() !== "none") {
			event.preventDefault();
			this.closeDialog();
			return;
		}
		if (!event.ctrlKey && !event.metaKey) return;

		const key = event.key.toLowerCase();
		if (key === "s") {
			event.preventDefault();
			this.newMessage();
		}
		if (key === "r" && this.account.user()) {
			event.preventDefault();
			this.refresh();
		}
	}

	protected newMessage(): void {
		this.router.navigate(["/create"]);
	}

	protected loginUrl(): string {
		return this.account.loginUrl("/account");
	}

	protected async refresh(): Promise<void> {
		this.loading.set(true);
		this.error.set("");
		try {
			const messages = await this.account.list();
			this.rows.set(
				await Promise.all(messages.map(async (message) => ({ ...message, record: await this.account.open(message.ownerBlob) })))
			);
		} catch (error) {
			this.error.set(apiError(error).error);
		} finally {
			this.loading.set(false);
		}
	}

	protected status(row: OwnedMessage): string {
		return row.burnReason ? STATUS[row.burnReason].short : "live";
	}

	protected statusLong(row: OwnedMessage): string {
		return row.burnReason ? STATUS[row.burnReason].long : "live";
	}

	protected views(row: OwnedMessage): string {
		return `${row.views}/${row.maxViews === 0 ? "∞" : row.maxViews}`;
	}

	/** Time left while live */
	protected when(row: OwnedMessage): string {
		if (row.burnedAt) return "-";
		return formatDuration(Date.parse(row.expiresAt) - Date.now());
	}

	protected preview(row: Row): string {
		if (row.burnedAt) return "";
		if (row.record) return row.record.preview;
		if (!row.ownerBlob) return "(no key copy)";
		return "(vault locked)";
	}

	protected link(row: Row): string {
		return row.record ? shareUrl(this.document.location.origin, row.id, row.record.secret) : "";
	}

	/* ---------- Vault ---------- */

	protected async setupVault(event: Event): Promise<void> {
		event.preventDefault();
		if (this.passphrase().length < MIN_PASSPHRASE_LENGTH) {
			return this.vaultError.set(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
		}
		if (this.passphrase() !== this.passphraseConfirm()) return this.vaultError.set("The passphrases don't match.");

		await this.runVault(() => this.account.setupVault(this.passphrase()));
	}

	protected async unlockVault(event: Event): Promise<void> {
		event.preventDefault();
		await this.runVault(() => this.account.unlockVault(this.passphrase()), "Wrong passphrase.");
	}

	protected async lockVault(): Promise<void> {
		await this.account.lockVault();
		await this.refresh();
	}

	private async runVault(action: () => Promise<void>, failure?: string): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		this.vaultError.set("");
		try {
			await action();
			this.passphrase.set("");
			this.passphraseConfirm.set("");
			await this.refresh();
		} catch (error) {
			this.vaultError.set(failure ?? (error instanceof Error ? error.message : apiError(error).error));
		} finally {
			this.busy.set(false);
		}
	}

	/* ---------- Message detail ---------- */

	protected async select(row: Row): Promise<void> {
		this.selected.set(row);
		this.content.set(null);
		this.detailError.set("");
		this.showPassword.set(false);
		this.linkName.set("");
		this.confirming.set("none");
		this.dialog.set("detail");

		if (row.burnedAt || !row.record) return;

		this.decrypting.set(true);
		try {
			const detail = await this.account.get(row.id);
			if (detail.ciphertext === null) return;
			const keys = await deriveKeys(row.record.secret, row.record.password);
			const content = await decrypt(keys.encryptionKey, detail.ciphertext);
			if (this.selected()?.id === row.id) this.content.set(content);
		} catch (error) {
			this.detailError.set(error instanceof Error ? "Could not decrypt this message." : apiError(error).error);
		} finally {
			this.decrypting.set(false);
		}
	}

	protected edit(row: Row): void {
		this.router.navigate(["/edit", row.id]);
	}

	/* ---------- Short links ---------- */

	protected linkNote(link: ShortLink): string {
		const expires = `expires in ${formatDuration(Date.parse(link.expiresAt) - Date.now())} (${dateTime(link.expiresAt)})`;
		return link.singleUse ? `works once · ${expires}` : expires;
	}

	/** Adds a short link, named from the input or random */
	protected async addLink(row: Row, event?: Event): Promise<void> {
		event?.preventDefault();
		const name = this.linkName().trim();
		if (!row.record) return;
		if (name && !ALIAS_PATTERN.test(name)) return this.detailError.set(ALIAS_RULES.replace(/^a/, "A"));

		const secret = row.record.secret;
		await this.runDetail(async () => {
			const link = await this.account.addLink(row.id, secret, name || undefined);
			this.setLinks(row.id, (links) => [...links, link]);
			this.linkName.set("");
		});
	}

	protected async revokeLink(row: Row, link: ShortLink): Promise<void> {
		await this.runDetail(async () => {
			try {
				await this.account.revokeLinks(row.id, link.id);
			} catch (error) {
				// Already used or expired: either way it's gone
				if (apiError(error).status !== 404) throw error;
			}
			this.setLinks(row.id, (links) => links.filter((l) => l.id !== link.id));
		});
	}

	/** Invalidates every short link; with `replace`, then makes a fresh random one */
	protected async revokeLinks(row: Row, replace = false): Promise<void> {
		if (!replace && this.confirming() !== "revoke-links") return this.confirming.set("revoke-links");
		const secret = row.record?.secret;
		await this.runDetail(async () => {
			await this.account.revokeLinks(row.id);
			this.setLinks(row.id, () => []);
			if (replace && secret) {
				const link = await this.account.addLink(row.id, secret);
				this.setLinks(row.id, () => [link]);
			}
		});
	}

	private setLinks(id: string, update: (links: ShortLink[]) => ShortLink[]): void {
		const apply = (row: Row) => (row.id === id ? { ...row, links: update(row.links) } : row);
		this.rows.update((rows) => rows.map(apply));
		const selected = this.selected();
		if (selected) this.selected.set(apply(selected));
	}

	/** Destructive actions take a second click instead of a browser confirm() */
	protected async revoke(row: Row): Promise<void> {
		if (this.confirming() !== "revoke") return this.confirming.set("revoke");
		await this.runDetail(async () => {
			const updated: Row = { ...(await this.account.revoke(row.id)), record: null, links: [] };
			this.rows.update((rows) => rows.map((r) => (r.id === row.id ? updated : r)));
			this.selected.set(updated);
			this.content.set(null);
		});
	}

	protected async remove(row: Row): Promise<void> {
		if (this.confirming() !== "delete") return this.confirming.set("delete");
		await this.runDetail(async () => {
			await this.account.remove(row.id);
			this.rows.update((rows) => rows.filter((r) => r.id !== row.id));
			this.closeDialog();
		});
	}

	private async runDetail(action: () => Promise<void>): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		this.detailError.set("");
		try {
			await action();
		} catch (error) {
			this.detailError.set(apiError(error).error);
		} finally {
			this.busy.set(false);
			this.confirming.set("none");
		}
	}

	/* ---------- Settings ---------- */

	protected openSettings(): void {
		this.currentPassphrase.set("");
		this.newPassphrase.set("");
		this.newPassphraseConfirm.set("");
		this.settingsMessage.set("");
		this.settingsError.set("");
		this.confirming.set("none");
		this.dialog.set("settings");
	}

	protected async changePassphrase(event: Event): Promise<void> {
		event.preventDefault();
		if (!this.checkNewPassphrase()) return;
		await this.runSettings(
			() => this.account.changePassphrase(this.currentPassphrase(), this.newPassphrase()),
			"Passphrase changed.",
			"Wrong current passphrase."
		);
	}

	protected async resetVault(): Promise<void> {
		if (!this.checkNewPassphrase()) return;
		if (this.confirming() !== "reset-vault") return this.confirming.set("reset-vault");
		await this.runSettings(
			() => this.account.setupVault(this.newPassphrase(), { reset: true }),
			"Vault reset. Older messages can no longer be decrypted here."
		);
		await this.refresh();
	}

	protected async deleteAccount(): Promise<void> {
		if (this.confirming() !== "delete-account") return this.confirming.set("delete-account");
		await this.runSettings(() => this.account.deleteAccount(), "");
		if (!this.account.user()) this.router.navigate(["/create"]);
	}

	protected async logout(): Promise<void> {
		try {
			await this.account.logout();
		} finally {
			this.router.navigate(["/create"]);
		}
	}

	private checkNewPassphrase(): boolean {
		this.settingsMessage.set("");
		if (this.newPassphrase().length < MIN_PASSPHRASE_LENGTH) {
			this.settingsError.set(`The new passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters.`);
			return false;
		}
		if (this.newPassphrase() !== this.newPassphraseConfirm()) {
			this.settingsError.set("The new passphrases don't match.");
			return false;
		}
		this.settingsError.set("");
		return true;
	}

	private async runSettings(action: () => Promise<void>, success: string, failure?: string): Promise<void> {
		if (this.busy()) return;
		this.busy.set(true);
		this.settingsError.set("");
		try {
			await action();
			this.settingsMessage.set(success);
			this.currentPassphrase.set("");
			this.newPassphrase.set("");
			this.newPassphraseConfirm.set("");
		} catch (error) {
			this.settingsError.set(failure ?? (error instanceof Error ? error.message : apiError(error).error));
		} finally {
			this.busy.set(false);
			this.confirming.set("none");
		}
	}

	/* ---------- Admin: link shortener ---------- */

	protected async openAdmin(): Promise<void> {
		this.apiKey.set("");
		this.clientSecret.set("");
		this.reconnecting.set(false);
		this.adminMessage.set("");
		this.adminError.set("");
		this.confirming.set("none");
		this.dialog.set("admin");
		await this.runAdmin(() => this.account.shortenerStatus(), "");
	}

	/** Sends the browser to the shortener's authorize page; it comes back to the server's callback. */
	protected async connectOAuth(event: Event): Promise<void> {
		event.preventDefault();
		const clientId = this.clientId().trim();
		if (!clientId) return this.adminError.set("Enter the client ID of the app registered at the link shortener.");
		if (this.busy()) return;
		this.busy.set(true);
		this.adminError.set("");
		try {
			const { authorizeUrl } = await this.account.startShortenerOAuth(
				clientId,
				this.clientSecret().trim() || undefined,
				this.endpoint().trim() || undefined
			);
			this.document.location.assign(authorizeUrl);
		} catch (error) {
			this.adminError.set(apiError(error).error);
			this.busy.set(false);
		}
	}

	protected async connectShortener(event: Event): Promise<void> {
		event.preventDefault();
		const key = this.apiKey().trim();
		if (!key) return this.adminError.set("Paste the API key first.");
		const endpoint = this.endpoint().trim() || undefined;
		const ok = await this.runAdmin(() => this.account.connectShortener(key, endpoint), "Connected. Short links are on.");
		if (ok) {
			this.apiKey.set("");
			this.reconnecting.set(false);
		}
	}

	protected async disconnectShortener(): Promise<void> {
		if (this.confirming() !== "disconnect") return this.confirming.set("disconnect");
		await this.runAdmin(() => this.account.disconnectShortener(), "Disconnected. Short links are off.");
	}

	protected async testShortener(): Promise<void> {
		await this.runAdmin(() => this.account.testShortener(), "The connection works.");
	}

	protected async saveShortenerOptions(event: Event, lifetime: string, domain: string, singleUse: boolean, providerExpiry: boolean): Promise<void> {
		event.preventDefault();
		const lifetimeMinutes = Number(lifetime);
		const domainId = domain.trim() === "" ? null : Number(domain);
		if (!Number.isSafeInteger(lifetimeMinutes) || lifetimeMinutes < 0) {
			return this.adminError.set("Lifetime must be a whole number of minutes (0 = as long as the message).");
		}
		if (domainId !== null && (!Number.isSafeInteger(domainId) || domainId < 0)) {
			return this.adminError.set("Domain id must be a whole number, or empty for the default.");
		}
		await this.runAdmin(
			() => this.account.updateShortener({ lifetimeMinutes, domainId, singleUse, providerExpiry }),
			"Link options saved."
		);
	}

	private async runAdmin(action: () => Promise<ShortenerStatus>, success: string): Promise<boolean> {
		if (this.busy()) return false;
		this.busy.set(true);
		this.adminMessage.set("");
		this.adminError.set("");
		try {
			const status = await action();
			this.shortener.set(status);
			this.endpoint.set(status.endpoint);
			this.clientId.set(status.oauthClient.clientId);
			this.useApiKey.set(status.connection.method === "api_key" && !status.oauthClient.clientId);
			this.adminMessage.set(success);
			return true;
		} catch (error) {
			this.adminError.set(apiError(error).error);
			return false;
		} finally {
			this.busy.set(false);
			this.confirming.set("none");
		}
	}

	protected closeDialog(): void {
		this.dialog.set("none");
		this.selected.set(null);
		this.content.set(null);
		this.confirming.set("none");
	}
}
