import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import { createShortener } from "../src/shortener.js";
import { fakeShortener } from "./fake-shortener.js";

const CLIENT_ID = "burnit-test";

/**
 * A minimal OpenID Connect provider: discovery, JWKS, an authorize endpoint that signs
 * in `nextSubject` immediately, and a token endpoint that issues RS256 ID tokens.
 */
function startProvider() {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", use: "sig", alg: "RS256" };
	const codes = new Map();
	const provider = { nextSubject: "alice", issuer: "" };

	const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const idToken = (claims) => {
		const input = `${base64url({ alg: "RS256", kid: "test", typ: "JWT" })}.${base64url(claims)}`;
		return `${input}.${sign("sha256", Buffer.from(input), privateKey).toString("base64url")}`;
	};

	const server = createServer((req, res) => {
		const url = new URL(req.url, provider.issuer);
		const json = (body) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));

		if (url.pathname === "/.well-known/openid-configuration") {
			return json({
				issuer: provider.issuer,
				authorization_endpoint: `${provider.issuer}/authorize`,
				token_endpoint: `${provider.issuer}/token`,
				jwks_uri: `${provider.issuer}/jwks`,
				response_types_supported: ["code"],
				subject_types_supported: ["public"],
				id_token_signing_alg_values_supported: ["RS256"],
				code_challenge_methods_supported: ["S256"],
			});
		}
		if (url.pathname === "/jwks") return json({ keys: [jwk] });
		if (url.pathname === "/authorize") {
			const code = randomBytes(16).toString("hex");
			codes.set(code, { nonce: url.searchParams.get("nonce"), subject: provider.nextSubject });
			const redirect = new URL(url.searchParams.get("redirect_uri"));
			redirect.searchParams.set("code", code);
			redirect.searchParams.set("state", url.searchParams.get("state"));
			return res.writeHead(302, { Location: redirect.href }).end();
		}
		if (url.pathname === "/token") {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const grant = codes.get(new URLSearchParams(body).get("code"));
				if (!grant) return res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"invalid_grant"}');
				const now = Math.floor(Date.now() / 1000);
				json({
					access_token: "access",
					token_type: "Bearer",
					expires_in: 300,
					id_token: idToken({
						iss: provider.issuer,
						sub: grant.subject,
						aud: CLIENT_ID,
						iat: now,
						exp: now + 300,
						nonce: grant.nonce,
						name: `${grant.subject} example`,
						email: `${grant.subject}@example.com`,
					}),
				});
			});
			return;
		}
		res.writeHead(404).end();
	});

	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			provider.issuer = `http://127.0.0.1:${server.address().port}`;
			provider.close = () => server.close();
			resolve(provider);
		})
	);
}

let provider;
let store;
let server;
let origin;
let fake;
let shortener;

before(async () => {
	provider = await startProvider();
	store = new Store(":memory:");
	fake = fakeShortener();
	shortener = createShortener({ store, fetch: fake.fetch });
	server = createApp({
		store,
		shortener,
		config: {
			staticDir: "/nonexistent",
			trustProxy: false,
			maxTtlSeconds: 366 * 86400,
			maxViews: 10000,
			maxMessageBytes: 1024,
			maxFailedAttempts: 1000,
			createLimit: 1000,
			openLimit: 1000,
			accountLimit: 1000,
			oidc: { issuer: provider.issuer, clientId: CLIENT_ID, clientSecret: "secret", providerName: "PocketID" },
			publicUrl: "",
			sessionDays: 30,
			adminEmails: ["Root@example.com"],
		},
	}).listen(0);
	await new Promise((resolve) => server.once("listening", resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
	server.close();
	provider.close();
	store.close();
});

const hash = (value) => createHash("sha256").update(value).digest("hex");

const request = async (method, path, { body, cookie, headers = {} } = {}) => {
	const response = await fetch(origin + path, {
		method,
		redirect: "manual",
		headers: {
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
			...(cookie ? { Cookie: cookie } : {}),
			...headers,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
};

/** Runs the whole browser login dance and returns the session cookie. */
async function login(subject = "alice", returnTo = "/account") {
	provider.nextSubject = subject;
	const start = await fetch(`${origin}/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { redirect: "manual" });
	assert.equal(start.status, 302);
	const authorize = new URL(start.headers.get("location"));
	assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
	assert.equal(authorize.searchParams.get("redirect_uri"), `${origin}/auth/callback`);

	const consent = await fetch(authorize, { redirect: "manual" });
	const callback = await fetch(consent.headers.get("location"), { redirect: "manual" });
	assert.equal(callback.status, 302);
	assert.equal(callback.headers.get("location"), returnTo);

	const setCookie = callback.headers.get("set-cookie");
	assert.match(setCookie, /HttpOnly/i);
	assert.match(setCookie, /SameSite=Lax/i);
	return setCookie.split(";")[0];
}

const createMessage = (cookie, overrides = {}) => {
	const authToken = randomBytes(32).toString("base64url");
	return request("POST", "/api/messages", {
		cookie,
		body: { ciphertext: "Y2lwaGVydGV4dA", authHash: hash(authToken), maxViews: 1, expiresIn: 3600, ...overrides },
	}).then((result) => ({ ...result, authToken }));
};

describe("signing in", () => {
	test("the session endpoint advertises the provider", async () => {
		const { body } = await request("GET", "/api/session");
		assert.deepEqual(body, {
			accounts: { enabled: true, provider: "PocketID" },
			user: null,
			admin: false,
			shortLinks: { enabled: false },
		});
	});

	test("logs in through the provider and creates an account once", async () => {
		const cookie = await login("alice");
		const { body } = await request("GET", "/api/session", { cookie });
		assert.equal(body.user.name, "alice example");
		assert.equal(body.user.email, "alice@example.com");
		assert.equal(body.user.vault, null);

		const again = await request("GET", "/api/session", { cookie: await login("alice") });
		assert.equal(again.body.user.id, body.user.id);
	});

	test("a callback without a pending login is rejected", async () => {
		const response = await fetch(`${origin}/auth/callback?code=x&state=forged`, { redirect: "manual" });
		assert.equal(response.headers.get("location"), "/account?login=failed");
		assert.equal(response.headers.get("set-cookie"), null);
	});

	test("return paths cannot leave the site", async () => {
		await login("alice", "/account");
		const start = await fetch(`${origin}/auth/login?returnTo=//evil.example`, { redirect: "manual" });
		const consent = await fetch(start.headers.get("location"), { redirect: "manual" });
		const callback = await fetch(consent.headers.get("location"), { redirect: "manual" });
		assert.equal(callback.headers.get("location"), "/account");
	});

	test("logging out ends the session", async () => {
		const cookie = await login("alice");
		assert.equal((await request("POST", "/api/account/logout", { cookie })).status, 204);
		assert.equal((await request("GET", "/api/session", { cookie })).body.user, null);
		assert.equal((await request("GET", "/api/account/messages", { cookie })).status, 401);
	});

	test("account routes require a session and a same-origin request", async () => {
		assert.equal((await request("GET", "/api/account/messages")).status, 401);
		const cookie = await login("alice");
		const forged = await request("DELETE", "/api/account", { cookie, headers: { Origin: "https://evil.example" } });
		assert.equal(forged.status, 403);
	});
});

describe("owned messages", () => {
	test("messages created while signed in are listed, with content, without using a view", async () => {
		const cookie = await login("bob");
		const { body: created } = await createMessage(cookie, { ownerBlob: "b3duZXI" });
		await createMessage(undefined);

		const list = await request("GET", "/api/account/messages", { cookie });
		assert.deepEqual(
			list.body.map((message) => message.id),
			[created.id]
		);
		assert.equal(list.body[0].ownerBlob, "b3duZXI");
		assert.equal(list.body[0].ciphertext, undefined);

		const detail = await request("GET", `/api/account/messages/${created.id}`, { cookie });
		assert.equal(detail.body.ciphertext, "Y2lwaGVydGV4dA");
		assert.equal(detail.body.views, 0);
	});

	test("other accounts cannot see or touch a message", async () => {
		const owner = await login("carol");
		const { body: created } = await createMessage(owner);
		const intruder = await login("mallory");

		assert.equal((await request("GET", `/api/account/messages/${created.id}`, { cookie: intruder })).status, 404);
		assert.equal((await request("POST", `/api/account/messages/${created.id}/revoke`, { cookie: intruder })).status, 409);
		assert.equal((await request("DELETE", `/api/account/messages/${created.id}`, { cookie: intruder })).status, 404);
		assert.equal((await request("GET", `/api/messages/${created.id}`)).status, 200);
	});

	test("reading the last view leaves a tombstone without content", async () => {
		const cookie = await login("dave");
		const { body: created, authToken } = await createMessage(cookie, { ownerBlob: "c2VjcmV0" });
		const opened = await request("POST", `/api/messages/${created.id}/open`, { body: { authToken } });
		assert.equal(opened.body.burned, true);

		assert.equal((await request("GET", `/api/messages/${created.id}`)).status, 404);
		const { body } = await request("GET", `/api/account/messages/${created.id}`, { cookie });
		assert.equal(body.burnReason, "read");
		assert.equal(body.views, 1);
		assert.equal(body.ciphertext, null);
		assert.equal(body.ownerBlob, null);
		assert.ok(body.burnedAt);
	});

	test("owners can change settings, content and key", async () => {
		const cookie = await login("erin");
		const { body: created, authToken } = await createMessage(cookie, { maxViews: 3 });
		await request("POST", `/api/messages/${created.id}/open`, { body: { authToken } });

		const tooFew = await request("PATCH", `/api/account/messages/${created.id}`, { cookie, body: { maxViews: 1 } });
		assert.equal(tooFew.status, 400);
		assert.equal(tooFew.body.type, "invalid_views");

		const newToken = randomBytes(32).toString("base64url");
		const updated = await request("PATCH", `/api/account/messages/${created.id}`, {
			cookie,
			body: { maxViews: 5, nocopy: true, expiresIn: 86400, ciphertext: "bmV3", authHash: hash(newToken), usePassword: true },
		});
		assert.equal(updated.status, 200);
		assert.equal(updated.body.maxViews, 5);
		assert.equal(updated.body.nocopy, true);
		assert.ok(Date.parse(updated.body.expiresAt) > Date.now() + 86000 * 1000);

		assert.equal((await request("POST", `/api/messages/${created.id}/open`, { body: { authToken } })).status, 403);
		const opened = await request("POST", `/api/messages/${created.id}/open`, { body: { authToken: newToken } });
		assert.equal(opened.body.ciphertext, "bmV3");
		assert.equal(opened.body.views, 2);
	});

	test("revoking destroys the message for everyone", async () => {
		const cookie = await login("frank");
		const { body: created, authToken } = await createMessage(cookie);
		const revoked = await request("POST", `/api/account/messages/${created.id}/revoke`, { cookie });
		assert.equal(revoked.body.burnReason, "revoked");
		assert.equal((await request("POST", `/api/messages/${created.id}/open`, { body: { authToken } })).status, 404);
		assert.equal((await request("PATCH", `/api/account/messages/${created.id}`, { cookie, body: { nocopy: true } })).status, 409);
	});

	test("deleting removes the history entry", async () => {
		const cookie = await login("grace");
		const { body: created } = await createMessage(cookie);
		assert.equal((await request("DELETE", `/api/account/messages/${created.id}`, { cookie })).status, 204);
		assert.equal((await request("GET", "/api/account/messages", { cookie })).body.length, 0);
		assert.equal((await request("GET", `/api/messages/${created.id}`)).status, 404);
	});

	test("expired owned messages become tombstones, then age out", async () => {
		const cookie = await login("heidi");
		const { body: created } = await createMessage(cookie);
		const later = Date.now() + 3601 * 1000;
		store.purgeExpired(later, 86_400_000);

		const { body } = await request("GET", `/api/account/messages/${created.id}`, { cookie });
		assert.equal(body.burnReason, "expired");
		store.purgeExpired(later + 86_400_001, 86_400_000);
		assert.equal((await request("GET", `/api/account/messages/${created.id}`, { cookie })).status, 404);
	});
});

describe("shortener admin", () => {
	const settingsUrl = "/api/account/admin/shortener";

	test("only admins can see or change the shortener settings", async () => {
		const cookie = await login("nina");
		assert.equal((await request("GET", "/api/session", { cookie })).body.admin, false);
		assert.equal((await request("GET", settingsUrl, { cookie })).status, 403);
		assert.equal((await request("POST", `${settingsUrl}/connect`, { cookie, body: { apiKey: "sdm_x" } })).status, 403);
	});

	test("admins connect with a verified key, which is stored encrypted and never sent back", async () => {
		const cookie = await login("root");
		assert.equal((await request("GET", "/api/session", { cookie })).body.admin, true);

		const wrong = await request("POST", `${settingsUrl}/connect`, { cookie, body: { apiKey: "sdm_wrong" } });
		assert.equal(wrong.status, 400);
		assert.equal(wrong.body.type, "invalid_credentials");
		assert.equal(shortener.enabled(), false);

		const connected = await request("POST", `${settingsUrl}/connect`, { cookie, body: { apiKey: fake.settings.apiKey } });
		assert.equal(connected.status, 200);
		assert.equal(connected.body.connection.connected, true);
		assert.equal(connected.body.connection.hint, "sdm_…test");
		assert.ok(!JSON.stringify(connected.body).includes(fake.settings.apiKey));
		assert.ok(!JSON.stringify(store.getSetting("shortener")).includes(fake.settings.apiKey));
		assert.equal((await request("GET", "/api/session", { cookie })).body.shortLinks.enabled, true);

		const updated = await request("PUT", settingsUrl, { cookie, body: { lifetimeMinutes: 30, singleUse: false } });
		assert.equal(updated.body.lifetimeMinutes, 30);
		assert.equal(updated.body.singleUse, false);
		assert.equal(updated.body.connection.connected, true);
		assert.equal((await request("PUT", settingsUrl, { cookie, body: { endpoint: "ftp://nope" } })).status, 400);
		assert.equal((await request("POST", `${settingsUrl}/test`, { cookie })).status, 200);

		const disconnected = await request("POST", `${settingsUrl}/disconnect`, { cookie });
		assert.equal(disconnected.body.connection.connected, false);
		assert.equal(shortener.enabled(), false);

		await request("PUT", settingsUrl, { cookie, body: { lifetimeMinutes: 15, singleUse: true } });
		await request("POST", `${settingsUrl}/connect`, { cookie, body: { apiKey: fake.settings.apiKey } });
	});
	test("admins connect through OAuth with PKCE; tokens refresh, and are revoked on disconnect", async () => {
		const cookie = await login("root");
		const follow = (url, cookie) => fetch(origin + url.pathname + url.search, { redirect: "manual", headers: { Cookie: cookie } });

		const started = await request("POST", `${settingsUrl}/oauth/start`, {
			cookie,
			body: { clientId: fake.client.clientId, clientSecret: fake.client.clientSecret },
		});
		assert.equal(started.status, 200);
		const authorizeUrl = new URL(started.body.authorizeUrl);
		assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://byh.uy/oauth/authorize");
		assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
		assert.equal(authorizeUrl.searchParams.get("client_id"), fake.client.clientId);
		assert.equal(authorizeUrl.searchParams.get("redirect_uri"), `${origin}/auth/shortener/callback`);

		const callback = fake.authorize(started.body.authorizeUrl);
		const intruder = await login("nina");
		assert.equal((await follow(callback, intruder)).headers.get("location"), "/account?shortener=forbidden");

		const done = await follow(callback, cookie);
		assert.equal(done.status, 302);
		assert.equal(done.headers.get("location"), "/account?shortener=connected");
		assert.equal((await follow(callback, cookie)).headers.get("location"), "/account?shortener=invalid_state");

		const { body: status } = await request("GET", settingsUrl, { cookie });
		assert.equal(status.connection.method, "oauth");
		assert.equal(status.connection.connected, true);
		assert.equal(status.connection.workspace, "Team");
		assert.equal(status.connection.refreshable, true);
		assert.equal(status.oauthClient.secretSet, true);
		assert.equal(status.redirectUri, `${origin}/auth/shortener/callback`);
		const saved = JSON.stringify(store.getSetting("shortener"));
		assert.ok(!JSON.stringify(status).includes("sdmo_") && !saved.includes("sdmo_") && !saved.includes("sdmr_"));
		assert.ok(!saved.includes(fake.client.clientSecret));

		const { body: created } = await createMessage(cookie);
		const link = await request("POST", `/api/account/messages/${created.id}/links`, {
			cookie,
			body: { secret: randomBytes(32).toString("base64url") },
		});
		assert.equal(link.status, 201);
		assert.match(fake.requests.at(-1).authorization, /^Bearer sdmo_/);

		// The access token stops working early: one refresh, and the refresh token rotates
		fake.accessTokens.clear();
		const oldRefresh = [...fake.refreshTokens];
		assert.equal((await request("POST", `${settingsUrl}/test`, { cookie })).status, 200);
		assert.equal(fake.refreshTokens.size, 1);
		assert.notDeepEqual([...fake.refreshTokens], oldRefresh);

		const disconnected = await request("POST", `${settingsUrl}/disconnect`, { cookie });
		assert.equal(disconnected.body.connection.connected, false);
		assert.equal(fake.refreshTokens.size, 0);
		assert.equal(fake.accessTokens.size, 0);

		// The rest of the tests use an API key
		await request("POST", `${settingsUrl}/connect`, { cookie, body: { apiKey: fake.settings.apiKey } });
	});
});

describe("short links of owned messages", () => {
	const secret = () => randomBytes(32).toString("base64url");

	test("owners add, list and invalidate short links without the access token", async () => {
		const cookie = await login("kim");
		const { body: created } = await createMessage(cookie);
		const linkUrl = `/api/account/messages/${created.id}/links`;
		const s = secret();

		const named = await request("POST", linkUrl, { cookie, body: { secret: s, alias: "KimsLink" } });
		assert.equal(named.status, 201);
		assert.equal(named.body.url, "https://byh.uy/KimsLink");
		const random = await request("POST", linkUrl, { cookie, body: { secret: s } });
		assert.equal(random.status, 201);

		const { body: listed } = await request("GET", "/api/account/messages", { cookie });
		const mine = listed.find((message) => message.id === created.id);
		assert.deepEqual(mine.links.map((link) => link.id).sort(), [named.body.id, random.body.id].sort());

		assert.equal((await request("DELETE", `${linkUrl}/${named.body.id}`, { cookie })).status, 204);
		assert.equal(fake.links.has(named.body.id), false);
		assert.equal((await request("DELETE", `${linkUrl}/${named.body.id}`, { cookie })).status, 404);
		assert.equal((await request("DELETE", linkUrl, { cookie })).status, 204);
		assert.equal(fake.links.has(random.body.id), false);
		assert.deepEqual((await request("GET", `/api/account/messages/${created.id}`, { cookie })).body.links, []);
	});

	test("other accounts cannot add or invalidate short links", async () => {
		const owner = await login("leo");
		const { body: created } = await createMessage(owner);
		const linkUrl = `/api/account/messages/${created.id}/links`;
		const added = await request("POST", linkUrl, { cookie: owner, body: { secret: secret() } });

		const intruder = await login("mallory");
		assert.equal((await request("POST", linkUrl, { cookie: intruder, body: { secret: secret() } })).status, 409);
		assert.equal((await request("DELETE", linkUrl, { cookie: intruder })).status, 404);
		assert.equal(fake.links.has(added.body.id), true);
	});

	test("short links die with their message", async () => {
		const cookie = await login("mia");
		const { body: created } = await createMessage(cookie);
		const added = await request("POST", `/api/account/messages/${created.id}/links`, { cookie, body: { secret: secret() } });
		await request("POST", `/api/account/messages/${created.id}/revoke`, { cookie });
		await shortener.sweep();
		assert.equal(fake.links.has(added.body.id), false);
	});
});

describe("vault", () => {
	test("stores the wrapped key, and a reset forgets old key copies", async () => {
		const cookie = await login("ivan");
		const vault = { salt: "c2FsdHNhbHRzYWx0c2FsdA", key: "d3JhcHBlZA" };
		const saved = await request("PUT", "/api/account/vault", { cookie, body: vault });
		assert.deepEqual(saved.body.vault, vault);

		const { body: created } = await createMessage(cookie, { ownerBlob: "b2xk" });
		await request("PUT", "/api/account/vault", { cookie, body: { ...vault, key: "bmV3", reset: true } });
		const { body } = await request("GET", `/api/account/messages/${created.id}`, { cookie });
		assert.equal(body.ownerBlob, null);
	});

	test("deleting the account deletes its messages", async () => {
		const cookie = await login("judy");
		const { body: created } = await createMessage(cookie);
		assert.equal((await request("DELETE", "/api/account", { cookie, headers: { Origin: origin } })).status, 204);
		assert.equal((await request("GET", `/api/messages/${created.id}`)).status, 404);
		assert.equal((await request("GET", "/api/session", { cookie })).body.user, null);
	});
});
