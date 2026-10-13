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
 */
export function parseMessage(input: string, now: Date = new Date()): ParseResult {
	const normalized = input.replace(/\r\n/g, "\n");
	const options: MessageOptions = {
		content: normalized,
		password: "",
		nocopy: false,
		maxViews: DEFAULT_MAX_VIEWS,
		expiresAt: addTime(now, DEFAULT_EXPIRATION.amount, DEFAULT_EXPIRATION.unit),
	};
	const errors: string[] = [];

	const separatorIndex = normalized.indexOf(SEPARATOR);
	if (separatorIndex === -1) return { options, errors };

	const header = normalized.slice(0, separatorIndex);
	const lines = header.split("\n").filter((line) => line.trim() !== "");
	if (lines.length === 0 || !ALL_KEYWORDS.includes(commandOf(lines[0]))) return { options, errors };

	options.content = normalized.slice(separatorIndex + SEPARATOR.length);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		const command = commandOf(line);
		const params = line.slice(command.length).trim();

		if (NOCOPY_KEYWORDS.includes(command)) {
			options.nocopy = true;
		} else if (ALIAS_KEYWORDS.includes(command)) {
			if (ALIAS_PATTERN.test(params)) options.alias = params;
			else errors.push(`"${line}": alias must be 3 - 20 letters or numbers.`);
		} else if (PASSWORD_KEYWORDS.includes(command)) {
			// Keep the password exactly as typed after the keyword, including inner spaces
			if (params) options.password = params;
			else errors.push(`"${line}": password cannot be empty.`);
		} else if (EXPIRATION_KEYWORDS.includes(command)) {
			const condition = params.replace(/^after\s+/i, "");
			const match = /^(\d+)\s*([a-zA-Z]+)$/.exec(condition);
			const unit = match && resolveUnit(match[2]);

			if (!match || !unit) {
				errors.push(`"${line}": expected a condition such as "3 days" or "1 view".`);
				continue;
			}

			const amount = Number(match[1]);
			if (unit === "view") {
				options.maxViews = amount;
			} else if (amount > 0) {
				options.expiresAt = addTime(now, amount, unit);
			} else {
				errors.push(`"${line}": expiration time must be greater than 0.`);
			}
		} else {
			errors.push(`"${line}": unknown configuration.`);
		}
	}

	return { options, errors };
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
