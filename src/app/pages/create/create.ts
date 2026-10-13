import { Component, ElementRef, computed, inject, signal, viewChild } from "@angular/core";
import { DOCUMENT } from "@angular/common";
import { MessageService, apiError } from "../../services/message.service";
import { MessageOptions, formatDuration, parseMessage } from "../../lib/message-config";
import { deriveKeys, encrypt, generateSecret, hashAuthToken, isCryptoAvailable } from "../../lib/crypto";

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
}

const summarize = (options: MessageOptions, now: Date): Summary => ({
	views: options.maxViews === 0 ? "unlimited" : String(options.maxViews),
	expires: formatDuration(options.expiresAt.getTime() - now.getTime()),
	password: options.password !== "",
	nocopy: options.nocopy,
	alias: options.alias ?? "random",
});

@Component({
	selector: "app-create",
	templateUrl: "./create.html",
	styleUrl: "./create.css",
	host: {
		"(document:keydown)": "onKeydown($event)",
	},
})
export class CreatePage {
	private readonly messages = inject(MessageService);
	private readonly document = inject(DOCUMENT);
	private readonly editor = viewChild.required<ElementRef<HTMLTextAreaElement>>("editor");

	protected readonly placeholder = PLACEHOLDER;
	protected readonly message = signal("");
	protected readonly dialog = signal<Dialog>("none");
	protected readonly submitting = signal(false);
	protected readonly errors = signal<string[]>([]);
	protected readonly shareUrl = signal("");
	protected readonly shared = signal<Summary | null>(null);
	protected readonly copied = signal(false);
	protected readonly cryptoAvailable = isCryptoAvailable();
	protected readonly canShare = typeof navigator !== "undefined" && "share" in navigator;

	/** Live preview of what the typed config will do */
	protected readonly parsed = computed(() => {
		const now = new Date();
		const { options, errors } = parseMessage(this.message(), now);
		return { summary: summarize(options, now), errorCount: errors.length, length: options.content.length };
	});

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
		this.dialog.set("none");
		this.editor().nativeElement.focus();
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

	protected async save(): Promise<void> {
		if (this.submitting()) return;

		if (!this.cryptoAvailable) {
			this.errors.set(["Encryption requires a secure connection (HTTPS or localhost)."]);
			return;
		}

		const now = new Date();
		const { options, errors } = parseMessage(this.message(), now);
		if (options.content.trim() === "") errors.push("Message cannot be blank.");
		this.errors.set(errors);
		if (errors.length > 0) return;

		this.submitting.set(true);
		try {
			const secret = generateSecret();
			const keys = await deriveKeys(secret, options.password);
			const { id } = await this.messages.create({
				alias: options.alias,
				ciphertext: await encrypt(keys.encryptionKey, options.content),
				authHash: await hashAuthToken(keys.authToken),
				usePassword: options.password !== "",
				nocopy: options.nocopy,
				maxViews: options.maxViews,
				expiresIn: Math.round((options.expiresAt.getTime() - now.getTime()) / 1000),
			});

			this.shareUrl.set(`${this.document.location.origin}/v/${id}#${secret}`);
			this.shared.set(summarize(options, now));
			this.copied.set(false);
			this.message.set("");
			this.dialog.set("complete");
		} catch (error) {
			this.errors.set([apiError(error).error]);
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
}
