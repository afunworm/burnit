import { createHash, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import * as oidc from "openid-client";

const SESSION_COOKIE = "burnit_session";
const LOGIN_TTL_MS = 10 * 60 * 1000;
const SCOPE = "openid profile email";

const sha256Hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function readCookie(req, name) {
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const index = part.indexOf("=");
		if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
	}
	return undefined;
}

/** Only same-site paths, so the login can't be used as an open redirect. */
function safeReturnTo(value) {
	if (typeof value !== "string" || value.length > 512) return "/account";
	if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/account";
	return value;
}

/**
 * Optional sign-in through an OpenID Connect provider (built for PocketID, works with any).
 * Uses the authorization code flow with PKCE, state and nonce; the pending login is kept
 * server side, and the session cookie only carries a random token whose hash is stored.
 */
export function createAuth({ store, config }) {
	const { issuer, clientId, clientSecret, providerName } = config.oidc;
	const enabled = Boolean(issuer && clientId && clientSecret);
	const sessionMs = config.sessionDays * 86_400_000;

	// Discovered on first use, so the server starts even while the provider is down
	let configuration;
	const getConfiguration = () => {
		configuration ??= oidc
			.discovery(
				new URL(issuer),
				clientId,
				clientSecret,
				undefined,
				issuer.startsWith("http://") ? { execute: [oidc.allowInsecureRequests] } : undefined
			)
			.catch((error) => {
				configuration = undefined;
				throw error;
			});
		return configuration;
	};

	const publicOrigin = (req) => config.publicUrl || `${req.protocol}://${req.get("host")}`;

	/** Attaches req.user when the request carries a valid session cookie. */
	const loadUser = (req, res, next) => {
		const token = readCookie(req, SESSION_COOKIE);
		if (enabled && token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
			req.sessionHash = sha256Hex(token);
			req.user = store.findSessionUser(req.sessionHash);
		}
		next();
	};

	const logout = (req, res) => {
		if (req.sessionHash) store.deleteSession(req.sessionHash);
		res.clearCookie(SESSION_COOKIE, { path: "/" });
		res.status(204).end();
	};

	const router = express.Router();

	router.get("/login", async (req, res) => {
		if (!enabled) return res.redirect("/account");

		try {
			const oidcConfig = await getConfiguration();
			const verifier = oidc.randomPKCECodeVerifier();
			const state = oidc.randomState();
			const nonce = oidc.randomNonce();

			store.saveLoginState({
				state,
				verifier,
				nonce,
				returnTo: safeReturnTo(req.query.returnTo),
				expiresAt: Date.now() + LOGIN_TTL_MS,
			});

			const url = oidc.buildAuthorizationUrl(oidcConfig, {
				redirect_uri: `${publicOrigin(req)}/auth/callback`,
				scope: SCOPE,
				code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
				code_challenge_method: "S256",
				state,
				nonce,
			});
			res.redirect(url.href);
		} catch (error) {
			console.error("Login could not be started:", error);
			res.redirect("/account?login=unavailable");
		}
	});

	router.get("/callback", async (req, res) => {
		const state = typeof req.query.state === "string" ? req.query.state : "";
		const pending = enabled && state ? store.takeLoginState(state) : undefined;
		if (!pending) return res.redirect("/account?login=failed");

		try {
			const tokens = await oidc.authorizationCodeGrant(
				await getConfiguration(),
				new URL(req.originalUrl, publicOrigin(req)),
				{ pkceCodeVerifier: pending.verifier, expectedState: state, expectedNonce: pending.nonce, idTokenExpected: true }
			);
			const claims = tokens.claims();
			const str = (value) => (typeof value === "string" ? value.slice(0, 200) : "");

			const user = store.upsertUser({
				id: randomUUID(),
				issuer: claims.iss,
				subject: claims.sub,
				name: str(claims.name) || str(claims.preferred_username) || str(claims.email) || "user",
				email: str(claims.email),
			});

			// A fresh token on every login; any previous session on this browser ends
			if (req.sessionHash) store.deleteSession(req.sessionHash);
			const token = randomBytes(32).toString("base64url");
			store.createSession(sha256Hex(token), user.id, Date.now() + sessionMs);

			res.cookie(SESSION_COOKIE, token, {
				httpOnly: true,
				secure: publicOrigin(req).startsWith("https:"),
				sameSite: "lax",
				path: "/",
				maxAge: sessionMs,
			});
			res.redirect(pending.returnTo);
		} catch (error) {
			console.error("Login failed:", error);
			res.redirect("/account?login=failed");
		}
	});

	return { enabled, providerName, publicOrigin, loadUser, logout, router };
}
