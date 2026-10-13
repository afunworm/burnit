import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { MessageStore } from "../src/store.js";

const config = {
	staticDir: "/nonexistent",
	trustProxy: false,
	maxTtlSeconds: 366 * 86400,
	maxViews: 10000,
	maxMessageBytes: 1024,
	maxFailedAttempts: 3,
	createLimit: 1000,
	openLimit: 1000,
};

let store;
let server;
let baseUrl;

before(async () => {
	store = new MessageStore(":memory:");
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

	test("rejects duplicate aliases", async () => {
		assert.equal((await create({ alias: "dupe" })).status, 201);
		const { status, body } = await create({ alias: "dupe" });
		assert.equal(status, 409);
		assert.equal(body.type, "already_exists");
	});

	for (const alias of ["ab", "has/slash", "a".repeat(21), "with space", "x%2Fy", 42]) {
		test(`rejects alias ${JSON.stringify(alias)}`, async () => {
			assert.equal((await create({ alias })).status, 400);
		});
	}

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

	test("a wrong token does not consume a view, and too many destroy the message", async () => {
		const { body: created, authToken } = await create();
		let result = await open(created.id, token());
		assert.equal(result.status, 403);
		assert.equal(result.body.attemptsLeft, 2);
		assert.equal((await request("GET", `/messages/${created.id}`)).body.views, 0);

		await open(created.id, token());
		result = await open(created.id, token());
		assert.equal(result.body.attemptsLeft, 0);
		assert.equal((await open(created.id, authToken)).status, 404);
	});

	test("ids cannot address fields inside a message", async () => {
		const { body: created } = await create();
		for (const id of [`${created.id}%2Fciphertext`, `${created.id}%2F`, "..", "%2F"]) {
			assert.equal((await request("GET", `/messages/${id}`)).status, 404, id);
		}
	});

	test("expired messages are rejected and purged", async () => {
		const { body: created, authToken } = await create({ alias: "expiring" });
		const later = Date.now() + 3601 * 1000;
		assert.equal(store.getMetadata(created.id, later), undefined);
		assert.equal((await open(created.id, authToken)).status, 404);

		await create({ alias: "purged" });
		assert.ok(store.purgeExpired(later) >= 1);
		assert.equal(store.getMetadata("purged"), undefined);
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
