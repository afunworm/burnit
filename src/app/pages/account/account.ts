import { Component, OnInit, inject, input, signal } from "@angular/core";
import { DOCUMENT, UpperCasePipe } from "@angular/common";
import { Router } from "@angular/router";
import { AccountService, BurnReason, OwnedMessage } from "../../services/account.service";
import { apiError, shareUrl } from "../../services/message.service";
import { decrypt, deriveKeys, isCryptoAvailable } from "../../lib/crypto";
import { formatDuration } from "../../lib/message-config";
import { OwnerRecord } from "../../lib/vault";

type Dialog = "none" | "detail" | "settings";
type Confirming = "none" | "revoke" | "delete" | "reset-vault" | "delete-account";

interface Row extends OwnedMessage {
	/** The decrypted owner record; null while locked, or when no key copy exists */
	record: OwnerRecord | null;
}

const MIN_PASSPHRASE_LENGTH = 8;

const STATUS: Record<BurnReason, { short: string; long: string }> = {
	read: { short: "read", long: "destroyed after its last view" },
	expired: { short: "expired", long: "destroyed when it expired" },
	attempts: { short: "wrong-pw", long: "destroyed after too many wrong passwords" },
	revoked: { short: "revoked", long: "destroyed by you" },
};

const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

@Component({
	selector: "app-account",
	imports: [UpperCasePipe],
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
	protected readonly copied = signal(false);

	// Settings
	protected readonly currentPassphrase = signal("");
	protected readonly newPassphrase = signal("");
	protected readonly newPassphraseConfirm = signal("");
	protected readonly settingsMessage = signal("");
	protected readonly settingsError = signal("");

	protected readonly minPassphraseLength = MIN_PASSPHRASE_LENGTH;
	protected readonly dateTime = dateTime;

	async ngOnInit(): Promise<void> {
		await this.account.ready;
		this.ready.set(true);
		if (this.account.user()) await this.refresh();
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
		this.copied.set(false);
		this.confirming.set("none");
		this.dialog.set("detail");

		if (row.burnedAt || !row.record) return;

		this.decrypting.set(true);
		try {
			const detail = await this.account.get(row.id);
			if (detail.ciphertext === null) return;
			const keys = await deriveKeys(row.record.secret, row.record.password);
			const content = await decrypt(keys.encryptionKey, detail.ciphertext);
			if (this.selected() === row) this.content.set(content);
		} catch (error) {
			this.detailError.set(error instanceof Error ? "Could not decrypt this message." : apiError(error).error);
		} finally {
			this.decrypting.set(false);
		}
	}

	protected edit(row: Row): void {
		this.router.navigate(["/edit", row.id]);
	}

	protected async copyLink(row: Row): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.link(row));
			this.copied.set(true);
		} catch {
			// Clipboard access can be denied; the link is still selectable
		}
	}

	/** Destructive actions take a second click instead of a browser confirm() */
	protected async revoke(row: Row): Promise<void> {
		if (this.confirming() !== "revoke") return this.confirming.set("revoke");
		await this.runDetail(async () => {
			const updated: Row = { ...(await this.account.revoke(row.id)), record: null };
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

	protected closeDialog(): void {
		this.dialog.set("none");
		this.selected.set(null);
		this.content.set(null);
		this.confirming.set("none");
	}
}
