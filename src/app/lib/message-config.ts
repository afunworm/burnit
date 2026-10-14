export type TimeUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

export interface MessageOptions {
	content: string;
	alias?: string;
	password: string;
	nocopy: boolean;
	/** 0 means unlimited views */
	maxViews: number;
	expiresAt: Date;
}

export interface ParseResult {
	options: MessageOptions;
	errors: string[];
}

export const DEFAULT_MAX_VIEWS = 1;
export const DEFAULT_EXPIRATION = { amount: 1, unit: "week" } as const;

const NOCOPY_KEYWORDS = ["nocopy", "obfuscate", "obfuscated"];
const ALIAS_KEYWORDS = ["alias", "name"];
const PASSWORD_KEYWORDS = ["password", "pwd", "pw"];
const EXPIRATION_KEYWORDS = [
	"expires",
	"expire",
	"exp",
	"expiration",
	"deletes",
	"delete",
	"destroys",
	"destroy",
	"removes",
	"remove",
];
const ALL_KEYWORDS = [...NOCOPY_KEYWORDS, ...ALIAS_KEYWORDS, ...PASSWORD_KEYWORDS, ...EXPIRATION_KEYWORDS];

const VIEW_UNITS = ["views", "view", "v", "times", "time", "t"];
const TIME_UNITS: Record<string, TimeUnit> = {
	minutes: "minute",
	minute: "minute",
	mins: "minute",
	min: "minute",
	hours: "hour",
	hour: "hour",
	hr: "hour",
	h: "hour",
	days: "day",
	day: "day",
	d: "day",
	weeks: "week",
	week: "week",
	wks: "week",
	wk: "week",
	w: "week",
	months: "month",
	month: "month",
	mo: "month",
	years: "year",
	year: "year",
	yrs: "year",
	yr: "year",
	y: "year",
};

const SEPARATOR = "\n---\n";
const ALIAS_PATTERN = /^[A-Za-z0-9]{3,20}$/;

export function addTime(date: Date, amount: number, unit: TimeUnit): Date {
	const result = new Date(date);
	switch (unit) {
		case "minute":
			result.setMinutes(result.getMinutes() + amount);
			break;
		case "hour":
			result.setHours(result.getHours() + amount);
			break;
		case "day":
			result.setDate(result.getDate() + amount);
			break;
		case "week":
			result.setDate(result.getDate() + amount * 7);
			break;
		case "month":
			result.setMonth(result.getMonth() + amount);
			break;
		case "year":
			result.setFullYear(result.getFullYear() + amount);
			break;
	}
	return result;
}

/** "m" is minutes and "M" is months; every other unit is case-insensitive. */
function resolveUnit(unit: string): TimeUnit | "view" | undefined {
	if (unit === "m") return "minute";
	if (unit === "M") return "month";

	const lower = unit.toLowerCase();
	if (VIEW_UNITS.includes(lower)) return "view";
	return TIME_UNITS[lower];
}

const commandOf = (line: string) => line.trim().split(/\s+/)[0].toLowerCase();

/**
 * Splits a message into its configuration header and content.
 *
 * The header is only treated as configuration when its first line starts with a known
 * keyword. Otherwise the whole input (including any `---`) is the message. Inside the
 * header, every line must be valid, so a typo like `pasword` is reported instead of
 * being silently ignored.
 *
 * `defaults` replaces the default view limit and expiry, e.g. with an existing
 * message's current values while it is being edited.
 */
export function parseMessage(
	input: string,
	now: Date = new Date(),
	defaults: Partial<Pick<MessageOptions, "maxViews" | "expiresAt">> = {}
): ParseResult {
	const normalized = input.replace(/\r\n/g, "\n");
	const options: MessageOptions = {
		content: normalized,
		password: "",
		nocopy: false,
		maxViews: defaults.maxViews ?? DEFAULT_MAX_VIEWS,
		expiresAt: defaults.expiresAt ?? addTime(now, DEFAULT_EXPIRATION.amount, DEFAULT_EXPIRATION.unit),
	};
	const errors: string[] = [];

	const split = splitHeader(normalized);
	if (!split) return { options, errors };
	options.content = split.content;

	for (const line of split.lines) {
		const parsed = parseLine(line);
		switch (parsed.kind) {
			case "nocopy":
				options.nocopy = true;
				break;
			case "alias":
				options.alias = parsed.value;
				break;
			case "password":
				options.password = parsed.value;
				break;
			case "views":
				options.maxViews = parsed.amount;
				break;
			case "time":
				options.expiresAt = addTime(now, parsed.amount, parsed.unit);
				break;
			default:
				errors.push(`"${line}": ${parsed.error}`);
		}
	}

	return { options, errors };
}

type ConfigLine =
	| { kind: "nocopy" }
	| { kind: "alias" | "password"; value: string }
	| { kind: "views"; amount: number }
	| { kind: "time"; amount: number; unit: TimeUnit }
	| { kind: "invalid"; error: string };

export type ConfigKind = Exclude<ConfigLine["kind"], "invalid">;

/** The configuration lines and the content, or null when the input has no configuration header. */
function splitHeader(normalized: string): { lines: string[]; content: string } | null {
	const separatorIndex = normalized.indexOf(SEPARATOR);
	if (separatorIndex === -1) return null;

	const lines = normalized
		.slice(0, separatorIndex)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (lines.length === 0 || !ALL_KEYWORDS.includes(commandOf(lines[0]))) return null;

	return { lines, content: normalized.slice(separatorIndex + SEPARATOR.length) };
}

function parseLine(line: string): ConfigLine {
	const command = commandOf(line);
	const params = line.slice(command.length).trim();

	if (NOCOPY_KEYWORDS.includes(command)) return { kind: "nocopy" };
	if (ALIAS_KEYWORDS.includes(command)) {
		return ALIAS_PATTERN.test(params)
			? { kind: "alias", value: params }
			: { kind: "invalid", error: "alias must be 3 - 20 letters or numbers." };
	}
	if (PASSWORD_KEYWORDS.includes(command)) {
		// Keep the password exactly as typed after the keyword, including inner spaces
		return params ? { kind: "password", value: params } : { kind: "invalid", error: "password cannot be empty." };
	}
	if (EXPIRATION_KEYWORDS.includes(command)) {
		const condition = params.replace(/^after\s+/i, "");
		const match = /^(\d+)\s*([a-zA-Z]+)$/.exec(condition);
		const unit = match && resolveUnit(match[2]);
		if (!match || !unit) return { kind: "invalid", error: 'expected a condition such as "3 days" or "1 view".' };

		const amount = Number(match[1]);
		if (unit === "view") return { kind: "views", amount };
		if (amount > 0) return { kind: "time", amount, unit };
		return { kind: "invalid", error: "expiration time must be greater than 0." };
	}
	return { kind: "invalid", error: "unknown configuration." };
}

/** What the configuration lines currently say; settings without a line are left out. */
export interface ConfigValues {
	views?: number;
	time?: { amount: number; unit: TimeUnit };
	password?: string;
	nocopy: boolean;
	alias?: string;
}

export function readConfig(input: string): ConfigValues {
	const values: ConfigValues = { nocopy: false };
	for (const line of splitHeader(input.replace(/\r\n/g, "\n"))?.lines ?? []) {
		const parsed = parseLine(line);
		if (parsed.kind === "nocopy") values.nocopy = true;
		else if (parsed.kind === "alias") values.alias = parsed.value;
		else if (parsed.kind === "password") values.password = parsed.value;
		else if (parsed.kind === "views") values.views = parsed.amount;
		else if (parsed.kind === "time") values.time = { amount: parsed.amount, unit: parsed.unit };
	}
	return values;
}

/** A configuration line in its canonical form, e.g. "expires 3 views" or "expires 2 days". */
export function configLine(
	setting:
		| { kind: "views"; amount: number }
		| { kind: "time"; amount: number; unit: TimeUnit }
		| { kind: "password" | "alias"; value: string }
		| { kind: "nocopy" }
): string {
	switch (setting.kind) {
		case "views":
			return `expires ${setting.amount} ${setting.amount === 1 ? "view" : "views"}`;
		case "time":
			return `expires ${setting.amount} ${setting.unit}${setting.amount === 1 ? "" : "s"}`;
		case "nocopy":
			return "nocopy";
		default:
			return `${setting.kind} ${setting.value}`;
	}
}

/**
 * Replaces every configuration line of one kind with `line` (or removes them when null),
 * adding a header if the input had none. Other lines, including invalid ones, are kept.
 */
export function setConfigLine(input: string, kind: ConfigKind, line: string | null): string {
	const normalized = input.replace(/\r\n/g, "\n");
	const split = splitHeader(normalized) ?? { lines: [], content: normalized };

	const lines = split.lines.filter((existing) => parseLine(existing).kind !== kind);
	if (line) lines.push(line);

	// Without a header, content that looks like configuration would be read as such
	if (lines.length === 0 && !splitHeader(split.content)) return split.content;
	if (lines.length === 0) lines.push(configLine({ kind: "views", amount: DEFAULT_MAX_VIEWS }));

	return `${lines.join("\n")}${SEPARATOR}${split.content}`;
}

/** The editor text for an existing message: its settings as configuration, then the content. */
export function toEditorText(
	content: string,
	settings: { viewsLeft: number; password: string; nocopy: boolean }
): string {
	const header = [`expires ${settings.viewsLeft} ${settings.viewsLeft === 1 ? "view" : "views"}`];
	if (settings.password) header.push(`password ${settings.password}`);
	if (settings.nocopy) header.push("nocopy");
	return `${header.join("\n")}${SEPARATOR}${content}`;
}

/** Compact duration for display, e.g. "45m", "3h", "7d", "1y" (rounded to the largest whole unit). */
export function formatDuration(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	const units: [string, number][] = [
		["y", 365 * 24 * 60],
		["d", 24 * 60],
		["h", 60],
	];
	for (const [label, size] of units) {
		if (minutes >= size && minutes % size === 0) return `${minutes / size}${label}`;
	}
	for (const [label, size] of units) {
		if (minutes >= size) return `${Math.round(minutes / size)}${label}`;
	}
	return `${minutes}m`;
}
