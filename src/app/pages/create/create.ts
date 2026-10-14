import { Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from "@angular/core";
import { DOCUMENT } from "@angular/common";
import { Router, RouterLink } from "@angular/router";
import { MessageService, apiError, shareUrl } from "../../services/message.service";
import { AccountService, UpdateMessageRequest } from "../../services/account.service";
import { MessageOptions, formatDuration, parseMessage, toEditorText } from "../../lib/message-config";
import {
	MessageKeys,
	decrypt,
	deriveKeys,
	encrypt,
	generateSecret,
	hashAuthToken,
	isCryptoAvailable,
} from "../../lib/crypto";
import { OwnerRecord, previewOf } from "../../lib/vault";

type Dialog = "none" | "help" | "complete";

const PRESET = "expires 1 view\nexpires 1 week\n---\nYour message goes here...";
const GITHUB_URL = "https://github.com/afunworm/burnit";

const PLACEHOLDER = [
	"# Type your secret, then press Ctrl+S (or tap Save) to encrypt it.",
	"#",
	"# Optional config goes above a --- line:",
	"#   expires 1 day",
	"#   password hunter2",
	"#   ---",
	"#   the actual secret",
	"#",
	"# Ctrl+H (or Help) for every option.",
].join("\n");

export interface Summary {
	views: string;
	expires: string;
	password: boolean;
	nocopy: boolean;
	alias: string;
	/** Absolute expiry in the viewer's locale */
	expiresAt: string;
}

/** An existing message loaded into the editor */
interface Editing {
	id: string;
	record: OwnerRecord;
	keys: MessageKeys;
	views: number;
	viewsLeft: number;
	expiresAt: Date;
}

const summarize = (options: MessageOptions, now: Date): Summary => ({
	views: options.maxViews === 0 ? "unlimited" : String(options.maxViews),
	expires: formatDuration(options.expiresAt.getTime() - now.getTime()),
	password: options.password !== "",
	nocopy: options.nocopy,
	alias: options.alias ?? "random",
	expiresAt: options.expiresAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
});

const secondsUntil = (date: Date, now: Date) => Math.round((date.getTime() - now.getTime()) / 1000);

@Component({
	selector: "app-create",
	imports: [RouterLink],
	templateUrl: "./create.html",
	styleUrl: "./create.css",
	host: {
		"(document:keydown)": "onKeydown($event)",
	},
})
export class CreatePage implements OnInit {
	private readonly messages = inject(MessageService);
	protected readonly account = inject(AccountService);
	private readonly router = inject(Router);
	private readonly document = inject(DOCUMENT);
	private readonly editor = viewChild.required<ElementRef<HTMLTextAreaElement>>("editor");

	/** Bound from the `edit/:id` route parameter; undefined when creating */
	readonly id = input<string>();

	protected readonly placeholder = PLACEHOLDER;
	protected readonly message = signal("");
	protected readonly dialog = signal<Dialog>("none");
	protected readonly submitting = signal(false);
	protected readonly errors = signal<string[]>([]);
	protected readonly shareUrl = signal("");
	protected readonly createdId = signal("");
	protected readonly shared = signal<Summary | null>(null);
	/** Whether the last save went to the account, and with a key copy */
	protected readonly savedToAccount = signal<"no" | "with-key" | "without-key">("no");
	protected readonly passwordChanged = signal(false);
	protected readonly copied = signal(false);
	protected readonly editing = signal<Editing | null>(null);
	protected readonly cryptoAvailable = isCryptoAvailable();
	protected readonly canShare = typeof navigator !== "undefined" && "share" in navigator;

	/** Live preview of what the typed config will do */
	protected readonly parsed = computed(() => {
		const now = new Date();
		const { options, errors } = parseMessage(this.message(), now, this.defaults());
		return { summary: summarize(options, now), errorCount: errors.length, length: options.content.length };
	});

	/** While editing, leaving out a setting keeps its current value */
	private readonly defaults = computed(() => {
		const editing = this.editing();
		return editing ? { maxViews: editing.viewsLeft, expiresAt: editing.expiresAt } : {};
	});

	async ngOnInit(): Promise<void> {
		const id = this.id();
		if (id) await this.loadForEditing(id);
	}

	protected onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape" && this.dialog() !== "none") {
			event.preventDefault();
			this.closeDialog();
			return;
		}
		if (event.key === "F1") {
			event.preventDefault();
			this.toggleHelp();
			return;
		}
		if (!event.ctrlKey && !event.metaKey) return;

		const actions: Record<string, () => void> = {
			s: () => this.save(),
			enter: () => this.save(),
			h: () => this.toggleHelp(),
			r: () => this.reset(),
			p: () => this.insertPreset(),
			g: () => this.openGithub(),
			k: () => this.openAccount(),
		};
		const action = actions[event.key.toLowerCase()];
		if (action) {
			event.preventDefault();
			action();
		}
	}

	protected toggleHelp(): void {
		if (this.dialog() === "help") this.closeDialog();
		else this.dialog.set("help");
	}

	protected closeDialog(): void {
		const finishedEditing = this.dialog() === "complete" && this.id();
		this.dialog.set("none");
		if (finishedEditing) this.router.navigate(["/account"]);
		else this.editor().nativeElement.focus();
	}

	protected reset(): void {
		this.message.set("");
		this.errors.set([]);
		this.editor().nativeElement.focus();
	}

	protected insertPreset(): void {
		this.message.set(PRESET);
		this.errors.set([]);
		this.editor().nativeElement.focus();
	}

	protected openGithub(): void {
		window.open(GITHUB_URL, "_blank", "noopener");
	}

	protected openAccount(): void {
		if (this.account.enabled()) this.router.navigate(["/account"]);
	}

	protected async save(): Promise<void> {
		if (this.submitting()) return;

		if (!this.cryptoAvailable) {
			this.errors.set(["Encryption requires a secure connection (HTTPS or localhost)."]);
			return;
		}
		if (this.id() && !this.editing()) return;

		const now = new Date();
		const { options, errors } = parseMessage(this.message(), now, this.defaults());
		if (options.content.trim() === "") errors.push("Message cannot be blank.");
		if (this.editing() && options.alias) errors.push("The link of an existing message can't change; remove the alias line.");
		this.errors.set(errors);
		if (errors.length > 0) return;

		this.submitting.set(true);
		try {
			const editing = this.editing();
			if (editing) await this.update(editing, options, now);
			else await this.create(options, now);

			this.shared.set(summarize(options, now));
			this.copied.set(false);
			this.dialog.set("complete");
		} catch (error) {
			this.errors.set([error instanceof Error ? error.message : apiError(error).error]);
		} finally {
			this.submitting.set(false);
		}
	}

	protected async copyLink(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.shareUrl());
			this.copied.set(true);
		} catch {
			// Clipboard access can be denied; the link is still selectable
		}
	}

	protected async shareLink(): Promise<void> {
		try {
			await navigator.share({ title: "Secret message", url: this.shareUrl() });
		} catch {
			// Dismissed by the user
		}
	}

	private async create(options: MessageOptions, now: Date): Promise<void> {
		const secret = generateSecret();
		const keys = await deriveKeys(secret, options.password);
		const signedIn = this.account.user() !== null;
		const ownerBlob = signedIn
			? await this.account.seal({ secret, password: options.password, preview: previewOf(options.content) })
			: undefined;

		const { id } = await this.messages.create({
			alias: options.alias,
			ciphertext: await encrypt(keys.encryptionKey, options.content),
			authHash: await hashAuthToken(keys.authToken),
			usePassword: options.password !== "",
			nocopy: options.nocopy,
			maxViews: options.maxViews,
			expiresIn: secondsUntil(options.expiresAt, now),
			ownerBlob,
		});

		this.shareUrl.set(shareUrl(this.document.location.origin, id, secret));
		this.createdId.set(id);
		this.savedToAccount.set(!signedIn ? "no" : ownerBlob ? "with-key" : "without-key");
		this.message.set("");
	}

	private async update(editing: Editing, options: MessageOptions, now: Date): Promise<void> {
		const passwordChanged = options.password !== editing.record.password;
		const keys = passwordChanged ? await deriveKeys(editing.record.secret, options.password) : editing.keys;
		const record: OwnerRecord = { ...editing.record, password: options.password, preview: previewOf(options.content) };

		const ownerBlob = await this.account.seal(record);
		if (!ownerBlob) throw new Error("Your vault was locked. Unlock it on the account page, then save again.");

		const changes: UpdateMessageRequest = {
			ciphertext: await encrypt(keys.encryptionKey, options.content),
			nocopy: options.nocopy,
			// The editor counts views from now on; the server counts them in total
			maxViews: options.maxViews === 0 ? 0 : editing.views + options.maxViews,
			ownerBlob,
		};
		if (passwordChanged) {
			changes.authHash = await hashAuthToken(keys.authToken);
			changes.usePassword = options.password !== "";
		}
		if (options.expiresAt !== editing.expiresAt) changes.expiresIn = secondsUntil(options.expiresAt, now);

		const updated = await this.account.update(editing.id, changes);
		this.editing.set({ ...editing, record, keys, expiresAt: new Date(updated.expiresAt) });
		this.shareUrl.set(shareUrl(this.document.location.origin, editing.id, record.secret));
		this.createdId.set(editing.id);
		this.passwordChanged.set(passwordChanged);
	}

	private async loadForEditing(id: string): Promise<void> {
		await this.account.ready;
		const fail = (message: string) => this.errors.set([message]);

		if (!this.account.user()) return fail("Sign in to edit your messages.");
		if (this.account.vaultState() !== "unlocked") return fail("Unlock your vault on the account page to edit messages.");

		try {
			const message = await this.account.get(id);
			if (message.burnedAt || message.ciphertext === null) return fail("This message has already been destroyed.");

			const record = await this.account.open(message.ownerBlob);
			if (!record) return fail("Your vault has no key for this message, so its content can't be edited.");

			const keys = await deriveKeys(record.secret, record.password);
			const content = await decrypt(keys.encryptionKey, message.ciphertext);
			const viewsLeft = message.maxViews === 0 ? 0 : message.maxViews - message.views;

			this.editing.set({ id, record, keys, views: message.views, viewsLeft, expiresAt: new Date(message.expiresAt) });
			this.message.set(toEditorText(content, { viewsLeft, password: record.password, nocopy: message.nocopy }));
			this.editor().nativeElement.focus();
		} catch (error) {
			fail(error instanceof Error ? "Could not decrypt this message." : apiError(error).error);
		}
	}
}
