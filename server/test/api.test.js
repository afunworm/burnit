import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import { createShortener } from "../src/shortener.js";
import { fakeShortener } from "./fake-shortener.js";

const config = {
	staticDir: "/nonexistent",
	trustProxy: false,
	maxTtlSeconds: 366 * 86400,
	maxViews: 10000,
	maxMessageBytes: 1024,
	maxFailedAttempts: 1000,
	createLimit: 1000,
	openLimit: 1000,
	accountLimit: 1000,
	oidc: {},
	publicUrl: "",
	sessionDays: 30,
};

let store;
let server;
let baseUrl;
let fake;
let shortener;

before(async () => {
	store = new Store(":memory:");
	fake = fakeShortener();
	shortener = createShortener({ store, fetch: fake.fetch });
	await shortener.connect({ apiKey: fake.settings.apiKey });
	server = createApp({ store, config, shortener }).listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
	server.close();
	store.close();
});

const token = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");

const request = async (method, path, body) => {
	const response = await fetch(baseUrl + path, {
		method,
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
	});
	return { status: response.status, body: await response.json() };
};

const create = (overrides = {}) => {
	const authToken = overrides.authToken ?? token();
	const { authToken: _, ...rest } = overrides;
	return request("POST", "/messages", {
		ciphertext: "Y2lwaGVydGV4dA",
		authHash: hash(authToken),
		maxViews: 1,
		expiresIn: 3600,
		...rest,
	}).then((result) => ({ ...result, authToken }));
};

const open = (id, authToken) => request("POST", `/messages/${id}/open`, { authToken });

describe("creating messages", () => {
	test("generates a 10 character id", async () => {
		const { status, body } = await create();
		assert.equal(status, 201);
		assert.match(body.id, /^[A-Za-z0-9]{10}$/);
	});

	test("ignores the retired message alias; ids are always random", async () => {
		const { status, body } = await create({ alias: "retired" });
		assert.equal(status, 201);
		assert.match(body.id, /^[A-Za-z0-9]{10}$/);
	});

	for (const [field, value] of [
		["maxViews", -1],
		["maxViews", 1.5],
		["maxViews", "1"],
		["maxViews", 10001],
		["expiresIn", 30],
		["expiresIn", 367 * 86400],
		["expiresIn", undefined],
		["nocopy", "yes"],
		["ciphertext", "not base64!"],
		["ciphertext", ""],
		["authHash", "abc"],
	]) {
		test(`rejects ${field} = ${JSON.stringify(value)}`, async () => {
			assert.equal((await create({ [field]: value })).status, 400);
		});
	}

	test("rejects oversized messages", async () => {
		const { status } = await create({ ciphertext: "A".repeat(2000) });
		assert.equal(status, 413);
	});

	test("rejects malformed JSON", async () => {
		const { status, body } = await request("POST", "/messages", "{nope");
		assert.equal(status, 400);
		assert.equal(body.type, "invalid_request");
	});
});

describe("reading messages", () => {
	test("metadata never includes the ciphertext and does not count a view", async () => {
		const { body: created } = await create({ maxViews: 2, nocopy: true, usePassword: true });
		const { status, body } = await request("GET", `/messages/${created.id}`);
		assert.equal(status, 200);
		assert.equal(body.ciphertext, undefined);
		assert.deepEqual(
			{ ...body, expiresAt: undefined },
			{ usePassword: true, nocopy: true, maxViews: 2, views: 0, expiresAt: undefined }
		);
	});

	test("a single-view message is deleted when it is read", async () => {
		const { body: created, authToken } = await create();
		const opened = await open(created.id, authToken);
		assert.equal(opened.status, 200);
		assert.equal(opened.body.ciphertext, "Y2lwaGVydGV4dA");
		assert.equal(opened.body.burned, true);

		assert.equal((await request("GET", `/messages/${created.id}`)).status, 404);
		assert.equal((await open(created.id, authToken)).status, 404);
	});

	test("multi-view messages burn on the last view", async () => {
		const { body: created, authToken } = await create({ maxViews: 3 });
		assert.equal((await open(created.id, authToken)).body.burned, false);
		assert.equal((await open(created.id, authToken)).body.views, 2);
		assert.equal((await open(created.id, authToken)).body.burned, true);
		assert.equal((await open(created.id, authToken)).status, 404);
	});

	test("unlimited views are allowed with maxViews = 0", async () => {
		const { body: created, authToken } = await create({ maxViews: 0 });
		for (let i = 0; i < 5; i++) assert.equal((await open(created.id, authToken)).body.burned, false);
	});

	test("concurrent opens never exceed maxViews", async () => {
		const { body: created, authToken } = await create({ maxViews: 1 });
		const results = await Promise.all(Array.from({ length: 10 }, () => open(created.id, authToken)));
		assert.equal(results.filter((result) => result.status === 200).length, 1);
	});

	test("wrong tokens neither consume a view nor destroy the message", async () => {
		const { body: created, authToken } = await create();
		for (let i = 0; i < 20; i++) assert.equal((await open(created.id, token())).status, 403);
		assert.equal((await request("GET", `/messages/${created.id}`)).body.views, 0);
		assert.equal((await open(created.id, authToken)).status, 200);
	});

	test("ids cannot address fields inside a message", async () => {
		const { body: created } = await create();
		for (const id of [`${created.id}%2Fciphertext`, `${created.id}%2F`, "..", "%2F"]) {
			assert.equal((await request("GET", `/messages/${id}`)).status, 404, id);
		}
	});

	test("expired messages are rejected and purged", async () => {
		const { body: created, authToken } = await create();
		const later = Date.now() + 3601 * 1000;
		assert.equal(store.getMetadata(created.id, later), undefined);
		assert.equal((await open(created.id, authToken)).status, 404);

		const { body: purged } = await create();
		assert.ok(store.purgeExpired(later) >= 1);
		assert.equal(store.getMetadata(purged.id), undefined);
	});
});

describe("short links", () => {
	const secret = () => randomBytes(32).toString("base64url");
	const addLink = (id, body) => request("POST", `/messages/${id}/links`, body);
	const remote = (body) => fake.links.get(String(body.link?.id ?? body.id));

	test("a message can be created with a named short link at the shortener", async () => {
		const s = secret();
		const { status, body } = await create({ link: { secret: s, alias: "MyLink" } });
		assert.equal(status, 201);
		assert.equal(body.link.url, "https://byh.uy/MyLink");
		assert.equal(body.link.singleUse, true);
		assert.ok(Date.parse(body.link.expiresAt) <= Date.now() + 15 * 60_000);

		const made = remote(body);
		assert.match(made.url, new RegExp(`/v/${body.id}#${s}$`));
		assert.equal(made.clickLimit, 1);
		assert.equal(made.expiresAt, body.link.expiresAt);
	});

	test("a taken alias only costs the link; the message is still created", async () => {
		await create({ link: { secret: secret(), alias: "taken" } });
		const { status, body } = await create({ link: { secret: secret(), alias: "taken" } });
		assert.equal(status, 201);
		assert.ok(body.id);
		assert.equal(body.link, undefined);
		assert.equal(body.linkError.type, "already_exists");
	});

	for (const alias of ["ab", "has/slash", "a".repeat(65), "with space", "-dash", 42]) {
		test(`rejects alias ${JSON.stringify(alias)}`, async () => {
			assert.equal((await create({ link: { secret: secret(), alias } })).status, 400);
		});
	}

	test("rejects a malformed secret", async () => {
		assert.equal((await create({ link: { secret: "short" } })).status, 400);
	});

	test("adding a short link later needs the access token", async () => {
		const { body: created, authToken } = await create();
		const before = fake.links.size;
		assert.equal((await addLink(created.id, { authToken: token(), secret: secret() })).status, 403);
		assert.equal(fake.links.size, before);

		const added = await addLink(created.id, { authToken, secret: secret() });
		assert.equal(added.status, 201);
		assert.ok(remote(added.body));
	});

	test("short links never outlive their message", async () => {
		const { body } = await create({ expiresIn: 60, link: { secret: secret(), alias: "brief" } });
		assert.ok(Date.parse(body.link.expiresAt) <= Date.parse((await request("GET", `/messages/${body.id}`)).body.expiresAt));
	});

	test("short links are deleted at the shortener once their message burns", async () => {
		const { body, authToken } = await create({ link: { secret: secret(), alias: "burnt" } });
		await open(body.id, authToken);
		assert.ok(remote(body));
		await shortener.sweep();
		assert.equal(remote(body), undefined);
	});

	test("expired short links are deleted at the shortener", async () => {
		const { body } = await create({ link: { secret: secret() } });
		await shortener.sweep(Date.now() + 16 * 60_000);
		assert.equal(remote(body), undefined);
	});

	test("without a connection, short links are refused", async () => {
		const bare = new Store(":memory:");
		const app = createApp({ store: bare, config }).listen(0);
		await new Promise((resolve) => app.once("listening", resolve));
		try {
			const url = `http://127.0.0.1:${app.address().port}/api`;
			const session = await (await fetch(`${url}/session`)).json();
			assert.equal(session.shortLinks.enabled, false);
			const response = await fetch(`${url}/messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ciphertext: "YQ", authHash: hash(token()), maxViews: 1, expiresIn: 3600, link: { secret: secret() } }),
			});
			assert.equal((await response.json()).linkError.type, "shortener_disabled");
		} finally {
			app.close();
			bare.close();
		}
	});
});

describe("failed attempts", () => {
	test("block the client after too many, without touching the message", async () => {
		const strictStore = new Store(":memory:");
		const strict = createApp({ store: strictStore, config: { ...config, maxFailedAttempts: 3 } }).listen(0);
		await new Promise((resolve) => strict.once("listening", resolve));
		const url = `http://127.0.0.1:${strict.address().port}/api`;
		const post = (path, body) =>
			fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

		try {
			const authToken = token();
			const created = await (
				await post("/messages", { ciphertext: "YQ", authHash: hash(authToken), maxViews: 1, expiresIn: 3600 })
			).json();

			assert.equal((await post(`/messages/${created.id}/open`, { authToken: token() })).status, 403);
			assert.equal((await post(`/messages/${created.id}/links`, { authToken: token(), secret: "x".repeat(43) })).status, 403);
			assert.equal((await post(`/messages/${created.id}/open`, { authToken: token() })).status, 403);

			const blocked = await post(`/messages/${created.id}/open`, { authToken });
			assert.equal(blocked.status, 429);
			assert.equal((await blocked.json()).type, "locked_out");
			assert.equal(strictStore.getMetadata(created.id).views, 0);
		} finally {
			strict.close();
			strictStore.close();
		}
	});
});

describe("headers", () => {
	test("API responses are not cached and carry security headers", async () => {
		const response = await fetch(`${baseUrl}/health`);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("referrer-policy"), "no-referrer");
		assert.ok(response.headers.get("content-security-policy"));
		assert.equal(response.headers.get("x-powered-by"), null);
	});
});
