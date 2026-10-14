import { Component, computed, input } from "@angular/core";
import { encode } from "uqr";

/** A QR code drawn as one SVG path: dark modules on the terminal green, so scanners see dark-on-light. */
@Component({
	selector: "app-qr-code",
	template: `
		<svg
			role="img"
			[attr.aria-label]="'QR code for ' + value()"
			[attr.viewBox]="'0 0 ' + qr().size + ' ' + qr().size"
			shape-rendering="crispEdges"
		>
			<rect class="light" [attr.width]="qr().size" [attr.height]="qr().size" />
			<path class="dark" [attr.d]="qr().path" />
		</svg>
	`,
	styles: `
		:host {
			display: block;
			width: min(15rem, 100%);
			margin-top: 0.75rem;
		}

		svg {
			display: block;
			width: 100%;
			height: auto;
		}

		.light {
			fill: var(--fg);
		}

		.dark {
			fill: var(--bg);
		}
	`,
})
export class QrCode {
	readonly value = input.required<string>();

	protected readonly qr = computed(() => {
		// A 4-module quiet zone, as the spec asks for
		const { size, data } = encode(this.value(), { ecc: "M", border: 4 });
		let path = "";
		data.forEach((row, y) =>
			row.forEach((dark, x) => {
				if (dark) path += `M${x} ${y}h1v1h-1z`;
			})
		);
		return { size, path };
	});
}
