import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";

const config = {
	staticDir: "/nonexistent",
	trustProxy: false,
	maxTtlSeconds: 366 * 86400,
	maxViews: 10000,
	maxMessageBytes: 1024,
	maxFailedAttempts: 1000,
	shortLinkMinutes: 15,
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

before(async () => {
	store = new Store(":memory:");
	server = createApp({ store, config }).listen(0);
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
	const resolve = (code) => request("POST", `/links/${code}`);
	const addLink = (id, body) => request("POST", `/messages/${id}/links`, body);

	test("a message can be created with a named short link, which resolves once", async () => {
		const s = secret();
		const { status, body } = await create({ link: { secret: s, code: "MyLink" } });
		assert.equal(status, 201);
		assert.equal(body.link.code, "mylink");
		assert.ok(Date.parse(body.link.expiresAt) <= Date.now() + 15 * 60_000);

		const resolved = await resolve("MYLINK");
		assert.equal(resolved.status, 200);
		assert.deepEqual(resolved.body, { id: body.id, secret: s });
		assert.equal((await resolve("mylink")).status, 404);
	});

	test("names in use are refused, and the message is not created", async () => {
		await create({ link: { secret: secret(), code: "taken" } });
		const { status, body } = await create({ link: { secret: secret(), code: "Taken" } });
		assert.equal(status, 409);
		assert.equal(body.type, "already_exists");
	});

	test("a used name is free again", async () => {
		await create({ link: { secret: secret(), code: "reused" } });
		await resolve("reused");
		assert.equal((await create({ link: { secret: secret(), code: "reused" } })).status, 201);
	});

	for (const code of ["ab", "has/slash", "a".repeat(21), "with space", "account", "API", 42]) {
		test(`rejects short link name ${JSON.stringify(code)}`, async () => {
			assert.equal((await create({ link: { secret: secret(), code } })).status, 400);
		});
	}

	test("rejects a malformed secret", async () => {
		assert.equal((await create({ link: { secret: "short" } })).status, 400);
	});

	test("adding a short link later needs the access token", async () => {
		const { body: created, authToken } = await create();
		assert.equal((await addLink(created.id, { authToken: token(), secret: secret() })).status, 403);

		const added = await addLink(created.id, { authToken, secret: secret() });
		assert.equal(added.status, 201);
		assert.match(added.body.code, /^[a-z0-9]{6}$/);
		assert.equal((await resolve(added.body.code)).body.id, created.id);
	});

	test("short links expire, and never outlive their message", async () => {
		const { body } = await create({ expiresIn: 60, link: { secret: secret(), code: "brief" } });
		assert.ok(Date.parse(body.link.expiresAt) <= Date.parse((await request("GET", `/messages/${body.id}`)).body.expiresAt));
		assert.equal(store.resolveLink("brief", Date.now() + 61_000), undefined);
	});

	test("short links are deleted when the message burns", async () => {
		const { body, authToken } = await create({ link: { secret: secret(), code: "burnt" } });
		await open(body.id, authToken);
		assert.equal((await resolve("burnt")).status, 404);
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
			assert.equal((await post("/links/nosuchlink", {})).status, 404);
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
