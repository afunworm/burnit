import { Component, OnInit, inject, input, signal } from "@angular/core";
import { DOCUMENT } from "@angular/common";
import { Router } from "@angular/router";
import { MessageService, apiError, shareUrl } from "../../services/message.service";

/**
 * Trades a short link (`/<code>`) for the full message link and goes there.
 * The lookup is a POST, so it only happens in a real browser, and uses the short link up.
 */
@Component({
	selector: "app-short-link",
	template: `
		<div class="screen">
			<header class="titlebar">
				<span class="path"><span class="font-bold">burnit</span> <span class="dim">&nbsp;&mdash; ~/{{ code() }}</span></span>
			</header>

			<main class="output">
				@if (error(); as message) {
					<p class="err">ERR: {{ message }}</p>
					<p class="dim">&gt; short links work once, for a few minutes. Ask the sender for a new one.</p>
				} @else {
					<p class="cursor">&gt; resolving short link {{ code() }} ...</p>
				}
			</main>

			<nav class="keybar" aria-label="Actions">
				<button type="button" class="key" (click)="navigateToCreate()"><kbd>^S</kbd>New message</button>
			</nav>
		</div>
	`,
	host: {
		"(document:keydown)": "onKeydown($event)",
	},
})
export class ShortLinkPage implements OnInit {
	private readonly messages = inject(MessageService);
	private readonly router = inject(Router);
	private readonly document = inject(DOCUMENT);

	/** Bound from the `:code` route parameter */
	readonly code = input.required<string>();

	protected readonly error = signal("");

	async ngOnInit(): Promise<void> {
		try {
			const { id, secret } = await this.messages.resolveLink(this.code());
			// Replace, so the used-up short link doesn't stay in the history
			this.document.location.replace(shareUrl(this.document.location.origin, id, secret));
		} catch (error) {
			this.error.set(apiError(error).error);
		}
	}

	protected onKeydown(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			this.navigateToCreate();
		}
	}

	protected navigateToCreate(): void {
		this.router.navigate(["/create"]);
	}
}
