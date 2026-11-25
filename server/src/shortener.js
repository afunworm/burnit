import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "./errors.js";
import { createSecretBox } from "./secret-box.js";

/**
 * Short links through the Size Does Matter shortener (byh.uy, https://byh.uy/docs), or
 * any service with the same API. The server makes every call in the background; the
 * browser never sees the credentials.
 *
 * An admin connects once, either through OAuth 2.0 (authorization code + PKCE, with the
 * app registered in byh.uy's Admin ▸ Apps), or, as a fallback, by pasting an API key.
 * Tokens, refresh tokens, client secrets and keys are stored encrypted.
 */

export const DEFAULT_OPTIONS = {
	endpoint: "https://byh.uy/api/v1",
	// The shortener's domain to use; null for the workspace default
	domainId: null,
	// How long a short link works; 0 = as long as its message
	lifetimeMinutes: 15,
	// Ask the shortener to stop the link after one click (its "clickLimit" feature)
	singleUse: true,
	// Ask the shortener to expire the link itself (its "expiry" feature). Burnit deletes it either way.
	providerExpiry: true,
};

const SETTINGS_KEY = "shortener";
const PENDING_KEY = "shortener_oauth_pending";
const TIMEOUT_MS = 10_000;
// Matches the life of an authorization code at byh.uy
const PENDING_MS = 10 * 60_000;
// Refresh access tokens this long before they expire
const REFRESH_MARGIN_MS = 60_000;
const OAUTH_SCOPE = "links:read links:write";
const ENDPOINT_PATTERN = /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;
const TOKEN_PATTERN = /^[\x21-\x7e]{1,512}$/;
// The shortener's own alias rules
export const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

const unavailable = (message) => new ApiError(502, "shortener_error", message);
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const base64url = (bytes) => bytes.toString("base64url");

export function createShortener({ store, fetch = globalThis.fetch, secretBox = createSecretBox(randomBytes(32)) }) {
	let sweeping = false;
	// One refresh at a time: byh.uy rotates refresh tokens, and reusing an old one disconnects the app
	let refreshing;

	/**
	 * Everything stored: the link options, plus
	 *   connection: { method: "api_key", key } | { method: "oauth", access, refresh?, expiresAt?, scope, workspace }
	 *   oauthClient: { clientId, secret? }
	 * with every credential sealed by the secret box.
	 */
	const stored = () => store.getSetting(SETTINGS_KEY) ?? {};
	const save = (value) => store.setSetting(SETTINGS_KEY, value);
	const open = (sealed) => (sealed ? secretBox.open(sealed) : undefined);

	const options = () => {
		const { connection, oauthClient, ...rest } = stored();
		return { ...DEFAULT_OPTIONS, ...rest };
	};
	const connection = () => stored().connection;
	/** Whether the stored credential can still be decrypted */
	const readable = (current = connection()) =>
		Boolean(current) && open(current.method === "oauth" ? current.access : current.key) !== undefined;
	const enabled = () => Boolean(options().endpoint) && readable();

	const setConnection = (next) => {
		const all = stored();
		if (next) all.connection = next;
		else delete all.connection;
		save(all);
	};

	/* ---------- HTTP ---------- */

	async function send(url, init) {
		let response;
		try {
			response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
		} catch {
			throw unavailable("The link shortener could not be reached. Please try again.");
		}
		const text = await response.text();
		let body;
		try {
			body = text ? JSON.parse(text) : undefined;
		} catch {
			body = undefined;
		}
		return { status: response.status, ok: response.ok, body };
	}

	const apiUrl = (path, endpoint = options().endpoint) => endpoint.replace(/\/+$/, "") + path;

	/* ---------- OAuth ---------- */

	/** The service's OAuth endpoints, from its discovery document, or byh.uy's paths on the same host. */
	async function oauthServer(endpoint = options().endpoint) {
		const origin = new URL(endpoint).origin;
		const fallback = {
			authorize: `${origin}/oauth/authorize`,
			token: `${origin}/api/oauth/token`,
			revoke: `${origin}/api/oauth/revoke`,
		};
		try {
			const { ok, body } = await send(`${origin}/.well-known/oauth-authorization-server`, {
				headers: { Accept: "application/json" },
			});
			if (!ok || typeof body?.authorization_endpoint !== "string" || typeof body?.token_endpoint !== "string") {
				return fallback;
			}
			return {
				authorize: body.authorization_endpoint,
				token: body.token_endpoint,
				revoke: typeof body.revocation_endpoint === "string" ? body.revocation_endpoint : fallback.revoke,
			};
		} catch {
			return fallback;
		}
	}

	/** Calls the token (or revocation) endpoint as the registered client. */
	function clientRequest(url, params) {
		const { oauthClient } = stored();
		if (!oauthClient?.clientId) throw new ApiError(400, "invalid_request", "No OAuth app is set up.");
		const secret = open(oauthClient.secret);
		const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
		const body = new URLSearchParams(params);
		// Server apps authenticate with HTTP Basic; public apps only name themselves
		if (secret) {
			const credentials = `${encodeURIComponent(oauthClient.clientId)}:${encodeURIComponent(secret)}`;
			headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
		} else {
			body.set("client_id", oauthClient.clientId);
		}
		return send(url, { method: "POST", headers, body: body.toString() });
	}

	/** Turns a token response into a stored OAuth connection. */
	function oauthConnection(body, previous = {}, now = Date.now()) {
		if (typeof body?.access_token !== "string" || !TOKEN_PATTERN.test(body.access_token)) {
			throw unavailable("The link shortener sent an unexpected token response.");
		}
		const refresh = typeof body.refresh_token === "string" ? body.refresh_token : undefined;
		return {
			method: "oauth",
			access: secretBox.seal(body.access_token),
			refresh: refresh ? secretBox.seal(refresh) : undefined,
			expiresAt: Number.isFinite(body.expires_in) ? now + body.expires_in * 1000 : null,
			scope: typeof body.scope === "string" ? body.scope : (previous.scope ?? ""),
			workspace: typeof body.workspace?.name === "string" ? body.workspace.name : (previous.workspace ?? ""),
			connectedAt: previous.connectedAt ?? now,
		};
	}

	const oauthError = (body, fallback) =>
		[body?.error, body?.error_description].filter((part) => typeof part === "string").join(": ") || fallback;

	/** Refreshes the access token. Returns false if the connection is gone for good. */
	function refreshToken() {
		refreshing ??= (async () => {
			try {
				const current = connection();
				const refresh = current?.method === "oauth" ? open(current.refresh) : undefined;
				if (!refresh) return false;

				const server = await oauthServer();
				const { ok, status, body } = await clientRequest(server.token, { grant_type: "refresh_token", refresh_token: refresh });
				if (!ok) {
					// Rejected (revoked, expired after 90 days unused, or the app was disabled): reconnect needed
					if (status === 400 || status === 401) setConnection({ ...current, access: undefined, refresh: undefined, revoked: true });
					return false;
				}
				// Refresh tokens rotate: store the new one right away
				setConnection(oauthConnection(body, current));
				return true;
			} finally {
				refreshing = undefined;
			}
		})();
		return refreshing;
	}

	/** The bearer token for API calls, refreshing an OAuth token that is about to expire. */
	async function bearer() {
		const current = connection();
		if (current?.method === "api_key") return open(current.key);
		if (current?.method !== "oauth") return undefined;
		if (current.expiresAt && current.expiresAt - REFRESH_MARGIN_MS <= Date.now() && current.refresh) {
			await refreshToken();
			return open(connection()?.access);
		}
		return open(current.access);
	}

	/* ---------- API calls ---------- */

	async function call(method, path, body, { retried = false } = {}) {
		const { endpoint } = options();
		const token = endpoint ? await bearer() : undefined;
		if (!token) throw new ApiError(503, "shortener_disabled", "Short links are not set up on this server.");

		const result = await send(apiUrl(path, endpoint), {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		// An OAuth token can stop working early; a refresh may bring it back
		if (result.status === 401 && !retried && connection()?.method === "oauth" && (await refreshToken())) {
			return call(method, path, body, { retried: true });
		}
		return result;
	}

	const describeFailure = ({ status, body }) => {
		const code = body?.code;
		if (code === "alias_taken" || status === 409) {
			return new ApiError(409, "already_exists", "That alias is taken. Pick another one.");
		}
		if (status === 400) return new ApiError(400, "invalid_alias", body?.error || "The shortener refused this link.");
		if (status === 401) return unavailable("The link shortener no longer accepts burnit's credentials. An admin needs to reconnect it.");
		if (code === "insufficient_scope") {
			return unavailable("The link shortener connection lacks the links:write permission. An admin needs to reconnect it.");
		}
		if (code === "upgrade") {
			return unavailable(`The link shortener's plan doesn't allow this: ${body?.error || "upgrade required"}.`);
		}
		if (status === 403) return unavailable("The link shortener's credentials can't create links (viewer role?).");
		if (status === 429) return new ApiError(503, "shortener_busy", "The link shortener is busy. Please try again in a minute.");
		return unavailable(`The link shortener failed (HTTP ${status}).`);
	};

	const parseEndpoint = (value) => {
		const endpoint = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
		if (!ENDPOINT_PATTERN.test(endpoint)) {
			throw new ApiError(400, "invalid_request", "The endpoint must be an http(s) URL, e.g. https://byh.uy/api/v1.");
		}
		return endpoint;
	};

	/** Revokes OAuth tokens at the service; best effort, the local copy is dropped regardless. */
	async function revoke(current) {
		if (current?.method !== "oauth") return;
		try {
			const server = await oauthServer();
			for (const sealed of [current.refresh, current.access]) {
				const token = open(sealed);
				if (token) await clientRequest(server.revoke, { token });
			}
		} catch {
			// Unreachable: the tokens still stop working once the app is disconnected at byh.uy
		}
	}

	return {
		enabled,

		/** For the admin page. Credentials never leave the server, only hints of them. */
		status() {
			const { oauthClient } = stored();
			const current = connection();
			const ok = readable(current);
			return {
				...options(),
				oauthClient: {
					clientId: oauthClient?.clientId ?? "",
					secretSet: Boolean(open(oauthClient?.secret)),
				},
				connection: {
					method: current?.method ?? null,
					connected: ok,
					// Stored, but revoked at the service, or encrypted with a different SECRET_KEY
					needsReconnect: Boolean(current) && !ok,
					hint: ok && current.method === "api_key" ? current.hint : "",
					workspace: ok && current.method === "oauth" ? current.workspace : "",
					scope: ok && current.method === "oauth" ? current.scope : "",
					tokenExpiresAt: ok && current.method === "oauth" ? iso(current.expiresAt) : null,
					refreshable: ok && current.method === "oauth" && Boolean(current.refresh),
					connectedAt: ok ? iso(current.connectedAt) : null,
				},
			};
		},

		/** Changes the link options. Credentials go through connect(), the OAuth flow, or disconnect(). */
		updateOptions(body) {
			if (!body || typeof body !== "object") throw new ApiError(400, "invalid_request", "Request body must be JSON.");
			const next = stored();

			if (body.endpoint !== undefined) {
				const endpoint = parseEndpoint(body.endpoint);
				// Credentials belong to one service; moving to another one disconnects
				if (endpoint !== options().endpoint) delete next.connection;
				next.endpoint = endpoint;
			}
			if (body.domainId !== undefined) {
				if (body.domainId !== null && (!Number.isSafeInteger(body.domainId) || body.domainId < 0)) {
					throw new ApiError(400, "invalid_request", "domainId must be a whole number, or empty for the default.");
				}
				next.domainId = body.domainId;
			}
			if (body.lifetimeMinutes !== undefined) {
				const minutes = body.lifetimeMinutes;
				if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 527_040) {
					throw new ApiError(400, "invalid_request", "lifetimeMinutes must be a whole number of minutes (0 = as long as the message).");
				}
				next.lifetimeMinutes = minutes;
			}
			for (const flag of ["singleUse", "providerExpiry"]) {
				if (body[flag] === undefined) continue;
				if (typeof body[flag] !== "boolean") throw new ApiError(400, "invalid_request", `${flag} must be a boolean.`);
				next[flag] = body[flag];
			}

			save(next);
			return this.status();
		},

		/** Fallback: checks an API key against the service, and stores it (encrypted) if it works. */
		async connect(body) {
			const key = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
			if (!TOKEN_PATTERN.test(key)) {
				throw new ApiError(400, "invalid_request", "Paste the API key from byh.uy (API & webhooks ▸ New key).");
			}
			const endpoint = body.endpoint === undefined ? options().endpoint : parseEndpoint(body.endpoint);

			const result = await send(apiUrl("/me", endpoint), {
				headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
			});
			if (result.status === 401) {
				throw new ApiError(400, "invalid_credentials", "The shortener rejected this API key. Check it and try again.");
			}
			if (!result.ok) throw describeFailure(result);

			const previous = connection();
			save({
				...stored(),
				endpoint,
				connection: {
					method: "api_key",
					key: secretBox.seal(key),
					hint: `${key.slice(0, 4)}…${key.slice(-4)}`,
					connectedAt: Date.now(),
				},
			});
			await revoke(previous);
			return this.status();
		},

		/**
		 * Starts the OAuth flow: saves the app's client id (and secret, for a server app) and
		 * returns the service's authorize URL to send the admin to.
		 */
		async startOAuth({ clientId, clientSecret, endpoint }, { redirectUri, userId }) {
			const next = stored();
			if (clientId !== undefined) {
				const id = typeof clientId === "string" ? clientId.trim() : "";
				if (!TOKEN_PATTERN.test(id)) throw new ApiError(400, "invalid_request", "Enter the app's client ID from byh.uy (Admin ▸ Apps).");
				// A new app means the old secret no longer applies
				next.oauthClient = { clientId: id, secret: id === next.oauthClient?.clientId ? next.oauthClient.secret : undefined };
			}
			if (typeof clientSecret === "string" && clientSecret.trim() !== "") {
				if (!TOKEN_PATTERN.test(clientSecret.trim())) throw new ApiError(400, "invalid_request", "The client secret must be a single token.");
				next.oauthClient = { ...next.oauthClient, secret: secretBox.seal(clientSecret.trim()) };
			}
			if (endpoint !== undefined) {
				const parsed = parseEndpoint(endpoint);
				if (parsed !== options().endpoint) delete next.connection;
				next.endpoint = parsed;
			}
			if (!next.oauthClient?.clientId) throw new ApiError(400, "invalid_request", "Enter the app's client ID from byh.uy (Admin ▸ Apps).");
			save(next);

			const state = base64url(randomBytes(32));
			const verifier = base64url(randomBytes(48));
			store.setSetting(PENDING_KEY, {
				state,
				verifier: secretBox.seal(verifier),
				redirectUri,
				userId,
				expiresAt: Date.now() + PENDING_MS,
			});

			const server = await oauthServer();
			const url = new URL(server.authorize);
			url.search = new URLSearchParams({
				response_type: "code",
				client_id: next.oauthClient.clientId,
				redirect_uri: redirectUri,
				scope: OAUTH_SCOPE,
				state,
				code_challenge: base64url(createHash("sha256").update(verifier).digest()),
				code_challenge_method: "S256",
			}).toString();
			return { authorizeUrl: url.href };
		},

		/** Finishes the OAuth flow from the callback's query. Throws ApiError on any problem. */
		async finishOAuth(query, { userId }) {
			const pending = store.getSetting(PENDING_KEY);
			const state = typeof query.state === "string" ? query.state : "";
			if (!pending || pending.state !== state || pending.userId !== userId || pending.expiresAt <= Date.now()) {
				throw new ApiError(400, "invalid_state", "This sign-in attempt expired or wasn't started here. Try connecting again.");
			}
			// Each attempt can only be finished once
			store.setSetting(PENDING_KEY, null);

			if (typeof query.error === "string") {
				throw new ApiError(400, "access_denied", query.error === "access_denied" ? "The connection was cancelled." : query.error);
			}
			const code = typeof query.code === "string" ? query.code : "";
			if (!TOKEN_PATTERN.test(code)) throw new ApiError(400, "invalid_request", "The shortener sent no authorization code.");

			const server = await oauthServer();
			const { ok, body } = await clientRequest(server.token, {
				grant_type: "authorization_code",
				code,
				redirect_uri: pending.redirectUri,
				code_verifier: open(pending.verifier) ?? "",
			});
			if (!ok) throw unavailable(`The link shortener refused the connection (${oauthError(body, "token request failed")}).`);

			const previous = connection();
			setConnection(oauthConnection(body));
			// Replacing an API key or older connection: revoke what it held
			if (previous) await revoke(previous);
			return this.status();
		},

		/** Forgets the credential (revoking OAuth tokens). Links made so far keep working until they expire or burn. */
		async disconnect() {
			const previous = connection();
			setConnection(undefined);
			await revoke(previous);
			return this.status();
		},

		/** Checks the saved connection without changing anything. */
		async test() {
			const result = await call("GET", "/me");
			if (!result.ok) throw describeFailure(result);
			return this.status();
		},

		/**
		 * Creates a short link to `url`. `messageExpiresAt` caps its lifetime.
		 * Returns { id, url, expiresAt (ms), singleUse }.
		 */
		async create({ url, alias, messageExpiresAt, now = Date.now() }) {
			const current = options();
			const expiresAt =
				current.lifetimeMinutes > 0 ? Math.min(now + current.lifetimeMinutes * 60_000, messageExpiresAt) : messageExpiresAt;

			const body = { url };
			if (alias) body.alias = alias;
			if (current.domainId !== null) body.domainId = current.domainId;
			if (current.singleUse) body.clickLimit = 1;
			if (current.providerExpiry) body.expiresAt = new Date(expiresAt).toISOString();

			const result = await call("POST", "/links", body);
			if (!result.ok) throw describeFailure(result);

			const link = result.body;
			if (!link || link.id === undefined || typeof link.shortUrl !== "string") {
				throw unavailable("The link shortener sent an unexpected response.");
			}
			return { id: String(link.id), url: link.shortUrl, expiresAt, singleUse: current.singleUse };
		},

		/** Deletes a link at the shortener. Returns true once it's gone (including if it already was). */
		async remove(id) {
			const result = await call("DELETE", `/links/${encodeURIComponent(id)}`);
			return result.ok || result.status === 404;
		},

		/**
		 * Deletes, at the shortener, every link whose message burned or that ran out of time,
		 * and forgets it once that worked. Failures are retried on the next sweep.
		 */
		async sweep(now = Date.now()) {
			if (!enabled() || sweeping) return 0;
			sweeping = true;
			let removed = 0;
			try {
				for (const link of store.staleLinks(now)) {
					try {
						if (await this.remove(link.id)) {
							store.forgetLink(link.id);
							removed++;
						}
					} catch {
						// Unreachable right now; try again next time
					}
				}
			} finally {
				sweeping = false;
			}
			return removed;
		},
	};
}
