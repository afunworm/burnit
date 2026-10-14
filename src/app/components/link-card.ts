import { Component, input, signal } from "@angular/core";
import { QrCode } from "./qr-code";

/** A link with copy and QR code buttons. Extra buttons can be projected next to them. */
@Component({
	selector: "app-link-card",
	imports: [QrCode],
	template: `
		<div class="code-block link select-all">{{ url() }}</div>
		@if (note()) {
			<p class="dim -mt-2 mb-2">{{ note() }}</p>
		}
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn" (click)="copy()">{{ copied() ? "COPIED" : "COPY" }}</button>
			<button type="button" class="btn" [attr.aria-expanded]="showQr()" (click)="showQr.set(!showQr())">
				{{ showQr() ? "HIDE QR" : "QR CODE" }}
			</button>
			<ng-content />
		</div>
		@if (showQr()) {
			<app-qr-code [value]="url()" />
		}
	`,
	styles: `
		:host {
			display: block;
		}

		.link {
			font-weight: 700;
			word-break: break-all;
		}
	`,
})
export class LinkCard {
	readonly url = input.required<string>();
	readonly note = input("");

	protected readonly copied = signal(false);
	protected readonly showQr = signal(false);

	protected async copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.url());
			this.copied.set(true);
		} catch {
			// Clipboard access can be denied; the link is still selectable
		}
	}
}
