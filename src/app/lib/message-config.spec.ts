import { addTime, parseMessage } from "./message-config";

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

	it("handles Windows line endings", () => {
		const { options } = parseMessage("nocopy\r\n---\r\nline1\r\nline2", now);
		expect(options.nocopy).toBe(true);
		expect(options.content).toBe("line1\nline2");
	});
});
