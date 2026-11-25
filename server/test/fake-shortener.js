import { createHash } from "node:crypto";

/**
 * An in-memory stand-in for the byh.uy API (https://byh.uy/docs): POST /links,
 * DELETE /links/:id and GET /me with a bearer API key or OAuth access token, plus the
 * OAuth discovery, token (authorization_code + PKCE, rotating refresh_token) and revoke endpoints.
 */
export function fakeShortener({ key = "sdm_test", clientId = "sdmc_test", clientSecret = "sdms_test", expiresIn = 3600 } = {}) {
	const links = new Map();
	const requests = [];
	const codes = new Map();
	const accessTokens = new Set();
	const refreshTokens = new Set();
	const revoked = [];
	let nextId = 1;
	let nextToken = 1;

	const json = (status, body) =>
		new Response(body === undefined ? "" : JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});

	const issue = () => {
		const access = `sdmo_${nextToken}`;
		const refresh = `sdmr_${nextToken++}`;
		accessTokens.add(access);
		refreshTokens.add(refresh);
		return { access_token: access, token_type: "Bearer", scope: "links:read links:write", workspace: { id: 7, name: "Team" }, expires_in: expiresIn, refresh_token: refresh };
	};

	const clientOk = (init, params) => {
		const basic = init.headers?.Authorization?.match(/^Basic (.+)$/);
		if (!basic) return false;
		return Buffer.from(basic[1], "base64").toString() === `${clientId}:${clientSecret}`;
	};

	async function fetch(url, init = {}) {
		const { pathname } = new URL(url);
		const method = init.method ?? "GET";
		const isForm = init.headers?.["Content-Type"] === "application/x-www-form-urlencoded";
		const body = init.body ? (isForm ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body)) : undefined;
		requests.push({ method, pathname, body, authorization: init.headers?.Authorization });

		if (pathname === "/.well-known/oauth-authorization-server") {
			return json(200, {
				issuer: "https://byh.uy",
				authorization_endpoint: "https://byh.uy/oauth/authorize",
				token_endpoint: "https://byh.uy/api/oauth/token",
				revocation_endpoint: "https://byh.uy/api/oauth/revoke",
			});
		}
		if (pathname === "/api/oauth/token" && method === "POST") {
			if (!clientOk(init, body)) return json(401, { error: "invalid_client" });
			if (body.grant_type === "authorization_code") {
				const grant = codes.get(body.code);
				codes.delete(body.code);
				const challenge = createHash("sha256").update(body.code_verifier ?? "").digest("base64url");
				if (!grant || grant.challenge !== challenge || grant.redirectUri !== body.redirect_uri) {
					return json(400, { error: "invalid_grant" });
				}
				return json(200, issue());
			}
			if (body.grant_type === "refresh_token") {
				if (!refreshTokens.delete(body.refresh_token)) return json(400, { error: "invalid_grant" });
				return json(200, issue());
			}
			return json(400, { error: "unsupported_grant_type" });
		}
		if (pathname === "/api/oauth/revoke" && method === "POST") {
			if (!clientOk(init, body)) return json(401, { error: "invalid_client" });
			accessTokens.delete(body.token);
			refreshTokens.delete(body.token);
			revoked.push(body.token);
			return json(200, {});
		}

		const bearer = init.headers?.Authorization?.replace(/^Bearer /, "");
		if (bearer !== key && !accessTokens.has(bearer)) return json(401, { error: "Invalid API key", code: "unauthorized" });
		if (method === "GET" && pathname === "/api/v1/me") return json(200, { id: 1 });

		if (method === "POST" && pathname === "/api/v1/links") {
			if (!body?.url) return json(400, { error: "url: Invalid input" });
			const alias = body.alias ?? `r${nextId}x`;
			if ([...links.values()].some((link) => link.alias === alias)) {
				return json(400, { error: "That alias is taken.", code: "alias_taken" });
			}
			const link = { id: nextId++, alias, url: body.url, shortUrl: `https://byh.uy/${alias}`, ...body };
			links.set(String(link.id), link);
			return json(201, link);
		}

		const match = pathname.match(/^\/api\/v1\/links\/([^/]+)$/);
		if (method === "DELETE" && match) {
			return links.delete(decodeURIComponent(match[1])) ? json(200, { ok: true }) : json(404, { error: "Not found" });
		}
		return json(404, { error: "Not found" });
	}

	/** What byh.uy's authorize page does when the user clicks Authorize: returns the callback URL. */
	function authorize(authorizeUrl) {
		const params = new URL(authorizeUrl).searchParams;
		const code = `code_${nextToken++}`;
		codes.set(code, { challenge: params.get("code_challenge"), redirectUri: params.get("redirect_uri") });
		const callback = new URL(params.get("redirect_uri"));
		callback.searchParams.set("code", code);
		callback.searchParams.set("state", params.get("state"));
		return callback;
	}

	return {
		fetch,
		authorize,
		links,
		requests,
		accessTokens,
		refreshTokens,
		revoked,
		client: { clientId, clientSecret },
		settings: { endpoint: "https://byh.uy/api/v1", apiKey: key },
	};
}
