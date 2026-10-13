import { Component, OnInit, computed, inject, input, signal } from "@angular/core";
import { DOCUMENT, NgTemplateOutlet } from "@angular/common";
import { Router } from "@angular/router";
import { MessageMetadata, MessageService, apiError } from "../../services/message.service";
import { decrypt, deriveKeys, isCryptoAvailable } from "../../lib/crypto";

type State = "loading" | "invalid-link" | "unsupported" | "not-found" | "ready" | "opened" | "error";

interface Segment {
	text: string;
	noise: boolean;
}

const NOISE_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()-_=+[{]}|;:,./?";

const noise = (length = 2): Segment => {
	const random = crypto.getRandomValues(new Uint8Array(length));
	return { text: Array.from(random, (n) => NOISE_CHARACTERS[n % NOISE_CHARACTERS.length]).join(""), noise: true };
};

@Component({
	selector: "app-view",
	imports: [NgTemplateOutlet],
	templateUrl: "./view.html",
	styleUrl: "./view.css",
	host: {
		"(document:keydown)": "onKeydown($event)",
	},
})
export class ViewPage implements OnInit {
	private readonly messages = inject(MessageService);
	private readonly router = inject(Router);
	private readonly document = inject(DOCUMENT);

	/** Bound from the `v/:id` route parameter */
	readonly id = input.required<string>();

	protected readonly state = signal<State>("loading");
	protected readonly metadata = signal<MessageMetadata | null>(null);
	protected readonly opening = signal(false);
	protected readonly password = signal("");
	protected readonly passwordError = signal("");
	protected readonly errorMessage = signal("");
	protected readonly content = signal("");
	protected readonly burned = signal(false);

	protected readonly viewsLeft = computed(() => {
		const metadata = this.metadata();
		return metadata && metadata.maxViews > 0 ? metadata.maxViews - metadata.views : null;
	});

	/** For nocopy messages: each character interleaved with invisible random noise */
	protected readonly segments = computed<Segment[]>(() => {
		if (!this.metadata()?.nocopy) return [];
		return [noise(), ...[...this.content()].flatMap((char) => [{ text: char, noise: false }, noise()])];
	});

	private secret = "";

	async ngOnInit(): Promise<void> {
		this.secret = this.document.location.hash.slice(1);

		if (!isCryptoAvailable()) return this.state.set("unsupported");
		if (!/^[A-Za-z0-9_-]{43}$/.test(this.secret)) return this.state.set("invalid-link");

		try {
			this.metadata.set(await this.messages.getMetadata(this.id()));
			this.state.set("ready");
		} catch (error) {
			this.fail(error);
		}
	}

	protected onKeydown(event: KeyboardEvent): void {
		if (!event.ctrlKey && !event.metaKey) return;

		const key = event.key.toLowerCase();
		if (key === "s") {
			event.preventDefault();
			this.navigateToCreate();
		}
		// Leave Ctrl + V alone inside inputs, so the password can be pasted
		if (key === "v" && !(event.target instanceof HTMLInputElement)) {
			event.preventDefault();
			this.open();
		}
	}

	protected navigateToCreate(): void {
		this.router.navigate(["/create"]);
	}

	protected async open(event?: Event): Promise<void> {
		event?.preventDefault();
		if (this.state() !== "ready" || this.opening()) return;

		this.opening.set(true);
		this.passwordError.set("");

		try {
			const keys = await deriveKeys(this.secret, this.password());
			const opened = await this.messages.open(this.id(), keys.authToken);
			const { ciphertext, burned, ...metadata } = opened;

			this.content.set(await decrypt(keys.encryptionKey, ciphertext));
			this.metadata.set(metadata);
			this.burned.set(burned);
			this.state.set("opened");

			// The key is useless once the message is gone; don't leave it in the address bar or history
			if (burned) history.replaceState(history.state, "", this.document.location.pathname);
		} catch (error) {
			const { status, attemptsLeft } = apiError(error);
			if (status === 403 && attemptsLeft) {
				this.passwordError.set(
					`${this.metadata()?.usePassword ? "Invalid password" : "Invalid link"}. ${attemptsLeft} attempt(s) left before the message is destroyed.`
				);
				return;
			}
			this.fail(error);
		} finally {
			this.opening.set(false);
		}
	}

	protected preventCopy(event: Event): void {
		event.preventDefault();
	}

	private fail(error: unknown): void {
		const { status, error: message } = apiError(error);
		if (status === 404 || status === 403) {
			this.errorMessage.set(status === 403 ? message : "");
			this.state.set("not-found");
			return;
		}
		console.error(error);
		this.errorMessage.set(message);
		this.state.set("error");
	}
}
