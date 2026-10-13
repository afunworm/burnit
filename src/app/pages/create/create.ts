import { Component, ElementRef, inject, signal, viewChild } from "@angular/core";
import { DOCUMENT } from "@angular/common";
import { MessageService, apiError } from "../../services/message.service";
import { parseMessage } from "../../lib/message-config";
import { deriveKeys, encrypt, generateSecret, hashAuthToken, isCryptoAvailable } from "../../lib/crypto";

type Dialog = "none" | "help" | "complete";

const PRESET = "expires 1 view\nexpires 1 week\n---\nYour message goes here...";
const GITHUB_URL = "https://github.com/afunworm/burnit";

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

	protected readonly message = signal("");
	protected readonly dialog = signal<Dialog>("none");
	protected readonly submitting = signal(false);
	protected readonly errors = signal<string[]>([]);
	protected readonly shareUrl = signal("");
	protected readonly copied = signal(false);
	protected readonly cryptoAvailable = isCryptoAvailable();

	protected onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			this.closeDialog();
			return;
		}
		if (!event.ctrlKey && !event.metaKey) return;

		const actions: Record<string, () => void> = {
			s: () => this.save(),
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
		this.dialog.update((dialog) => (dialog === "help" ? "none" : "help"));
	}

	protected closeDialog(): void {
		this.dialog.set("none");
		this.editor().nativeElement.focus();
	}

	protected reset(): void {
		this.message.set("");
		this.errors.set([]);
	}

	protected insertPreset(): void {
		this.message.set(PRESET);
		this.errors.set([]);
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
}
