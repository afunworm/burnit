import { addTime, formatDuration, parseMessage, toEditorText } from "./message-config";

describe("parseMessage", () => {
	const now = new Date(2026, 0, 31, 12, 0, 0);

	it("uses defaults when there is no configuration", () => {
		const { options, errors } = parseMessage("hello", now);
		expect(errors).toEqual([]);
		expect(options).toEqual({
			content: "hello",
			password: "",
			nocopy: false,
			maxViews: 1,
			expiresAt: addTime(now, 1, "week"),
		});
	});

	it("parses every configuration type", () => {
		const input = "nocopy\nalias topSecret\npassword  secret sauce \nexpires 3 days\ndelete after 11 views\n---\nbody";
		const { options, errors } = parseMessage(input, now);
		expect(errors).toEqual([]);
		expect(options).toEqual({
			content: "body",
			alias: "topSecret",
			password: "secret sauce",
			nocopy: true,
			maxViews: 11,
			expiresAt: addTime(now, 3, "day"),
		});
	});

	it("supports compact conditions and case-sensitive m / M", () => {
		expect(parseMessage("exp 5m\n---\nx", now).options.expiresAt).toEqual(addTime(now, 5, "minute"));
		expect(parseMessage("exp 5M\n---\nx", now).options.expiresAt).toEqual(addTime(now, 5, "month"));
		expect(parseMessage("exp 2 Days\n---\nx", now).options.expiresAt).toEqual(addTime(now, 2, "day"));
		expect(parseMessage("exp 0v\n---\nx", now).options.maxViews).toBe(0);
	});

	it("does not strip 'after' from passwords", () => {
		expect(parseMessage("pw afterparty\n---\nx", now).options.password).toBe("afterparty");
	});

	it("keeps later separators as part of the content", () => {
		expect(parseMessage("nocopy\n---\na\n---\nb", now).options.content).toBe("a\n---\nb");
	});

	it("treats the input as plain content when the header isn't configuration", () => {
		const input = "Dear Bob,\n---\nregards";
		expect(parseMessage(input, now).options.content).toBe(input);
		expect(parseMessage("---\nhello", now).options.content).toBe("---\nhello");
	});

	it("reports invalid lines instead of ignoring them", () => {
		const { errors } = parseMessage(
			"nocopy\npasword x\nalias a/b\nexpires soon\nexpires 0 days\npassword\n---\nx",
			now
		);
		expect(errors).toHaveLength(5);
	});

	it("uses the given defaults when a setting is not configured", () => {
		const expiresAt = new Date(2026, 1, 3);
		const { options } = parseMessage("nocopy\n---\nx", now, { maxViews: 4, expiresAt });
		expect(options.maxViews).toBe(4);
		expect(options.expiresAt).toBe(expiresAt);
		expect(parseMessage("exp 2d\n---\nx", now, { expiresAt }).options.expiresAt).toEqual(addTime(now, 2, "day"));
	});

	it("round-trips an existing message through the editor text", () => {
		const content = "nocopy\n---\nlooks like config";
		const text = toEditorText(content, { viewsLeft: 2, password: "a b", nocopy: true });
		const { options, errors } = parseMessage(text, now);
		expect(errors).toEqual([]);
		expect(options).toMatchObject({ content, maxViews: 2, password: "a b", nocopy: true });
	});

	it("handles Windows line endings", () => {
		const { options } = parseMessage("nocopy\r\n---\r\nline1\r\nline2", now);
		expect(options.nocopy).toBe(true);
		expect(options.content).toBe("line1\nline2");
	});
});

describe("formatDuration", () => {
	it("uses the largest exact unit, then rounds", () => {
		expect(formatDuration(45 * 60_000)).toBe("45m");
		expect(formatDuration(3 * 3_600_000)).toBe("3h");
		expect(formatDuration(7 * 86_400_000)).toBe("7d");
		expect(formatDuration(365 * 86_400_000)).toBe("1y");
		expect(formatDuration(31 * 86_400_000)).toBe("31d");
		expect(formatDuration(90 * 60_000)).toBe("2h");
	});
});
