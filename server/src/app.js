import { existsSync } from "node:fs";
import path from "node:path";
import { createHash, randomInt } from "node:crypto";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createAuth } from "./auth.js";

const ID_PATTERN = /^[A-Za-z0-9]{3,20}$/;
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const GENERATED_ID_LENGTH = 10;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MIN_TTL_SECONDS = 60;
const MAX_BLOB_LENGTH = 8192;

class ApiError extends Error {
	constructor(status, type, message, extra = {}) {
		super(message);
		this.status = status;
		this.type = type;
		this.extra = extra;
	}
}

const generateId = () =>
	Array.from({ length: GENERATED_ID_LENGTH }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");

const sha256Hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const requireId = (id) => {
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		// Same response as a missing message, so malformed ids reveal nothing
		throw new ApiError(404, "not_found", "This message does not exist, or has expired.");
	}
	return id;
};

const requireInteger = (value, name, min, max) => {
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		throw new ApiError(400, "invalid_request", `${name} must be a whole number between ${min} and ${max}.`);
	}
	return value;
};

const requireBoolean = (value, name) => {
	if (value === undefined) return false;
	if (typeof value !== "boolean") throw new ApiError(400, "invalid_request", `${name} must be a boolean.`);
	return value;
};

const requireBase64Url = (value, name, maxLength) => {
	if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length > maxLength) {
		throw new ApiError(400, "invalid_request", `${name} must be a base64url string.`);
	}
	return value;
};

const requireCiphertext = (ciphertext, config) => {
	if (typeof ciphertext !== "string" || !BASE64URL_PATTERN.test(ciphertext)) {
		throw new ApiError(400, "invalid_request", "ciphertext must be a base64url string.");
	}
	if (ciphertext.length > Math.ceil((config.maxMessageBytes * 4) / 3)) {
		throw new ApiError(413, "message_too_large", `Messages cannot be larger than ${config.maxMessageBytes / 1024} KB.`);
	}
	return ciphertext;
};

const requireAuthHash = (authHash) => {
	if (typeof authHash !== "string" || !SHA256_HEX_PATTERN.test(authHash)) {
		throw new ApiError(400, "invalid_request", "authHash must be a lowercase hex SHA-256 digest.");
	}
	return authHash;
};

const requireExpiresIn = (expiresIn, config) => {
	if (!Number.isSafeInteger(expiresIn) || expiresIn < MIN_TTL_SECONDS || expiresIn > config.maxTtlSeconds) {
		const maxTtlDays = Math.floor(config.maxTtlSeconds / 86400);
		throw new ApiError(400, "invalid_expiration", `Messages must expire between 1 minute and ${maxTtlDays} days from now.`);
	}
	return expiresIn;
};

const requireJsonObject = (body) => {
	if (!body || typeof body !== "object") throw new ApiError(400, "invalid_request", "Request body must be JSON.");
	return body;
};

function parseCreateRequest(body, config) {
	requireJsonObject(body);

	const { alias } = body;
	if (alias !== undefined && (typeof alias !== "string" || !ID_PATTERN.test(alias))) {
		throw new ApiError(400, "invalid_alias", "Alias can only contain letters and numbers, and must be 3 - 20 characters long.");
	}

	return {
		alias,
		ciphertext: requireCiphertext(body.ciphertext, config),
		authHash: requireAuthHash(body.authHash),
		expiresIn: requireExpiresIn(body.expiresIn, config),
		maxViews: requireInteger(body.maxViews, "maxViews", 0, config.maxViews),
		usePassword: requireBoolean(body.usePassword, "usePassword"),
		nocopy: requireBoolean(body.nocopy, "nocopy"),
		ownerBlob: body.ownerBlob === undefined ? undefined : requireBase64Url(body.ownerBlob, "ownerBlob", MAX_BLOB_LENGTH),
	};
}

/** Every field is optional; only the ones present are changed. */
function parseUpdateRequest(body, config) {
	requireJsonObject(body);

	const changes = {};
	if (body.ciphertext !== undefined) changes.ciphertext = requireCiphertext(body.ciphertext, config);
	if (body.authHash !== undefined) changes.authHash = requireAuthHash(body.authHash);
	if (body.usePassword !== undefined) changes.usePassword = requireBoolean(body.usePassword, "usePassword");
	if (body.nocopy !== undefined) changes.nocopy = requireBoolean(body.nocopy, "nocopy");
	if (body.maxViews !== undefined) changes.maxViews = requireInteger(body.maxViews, "maxViews", 0, config.maxViews);
	if (body.expiresIn !== undefined) changes.expiresAt = Date.now() + requireExpiresIn(body.expiresIn, config) * 1000;
	if (body.ownerBlob !== undefined) {
		changes.ownerBlob = body.ownerBlob === null ? null : requireBase64Url(body.ownerBlob, "ownerBlob", MAX_BLOB_LENGTH);
	}
	return changes;
}

function parseVaultRequest(body) {
	requireJsonObject(body);
	return {
		salt: requireBase64Url(body.salt, "salt", 64),
		key: requireBase64Url(body.key, "key", 256),
		reset: requireBoolean(body.reset, "reset"),
	};
}

export function createApp({ store, config }) {
	const auth = createAuth({ store, config });
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", config.trustProxy);

	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					"default-src": ["'self'"],
					"script-src": ["'self'"],
					// Angular injects component styles at runtime; the font stylesheet is inlined at build time
					"style-src": ["'self'", "'unsafe-inline'"],
					"font-src": ["'self'", "https://fonts.gstatic.com"],
					"img-src": ["'self'", "data:"],
					"connect-src": ["'self'"],
					"upgrade-insecure-requests": null,
				},
			},
			referrerPolicy: { policy: "no-referrer" },
		})
	);
	app.use((req, res, next) => {
		res.set("X-Robots-Tag", "noindex, nofollow");
		next();
	});

	const limiter = (limit) =>
		rateLimit({
			windowMs: 15 * 60 * 1000,
			limit,
			standardHeaders: "draft-8",
			legacyHeaders: false,
			handler: (req, res) =>
				res.status(429).json({ error: "Too many requests. Please try again later.", type: "rate_limited" }),
		});

	const api = express.Router();
	api.use((req, res, next) => {
		res.set("Cache-Control", "no-store");
		next();
	});
	api.use(express.json({ limit: config.maxMessageBytes * 2 }));
	api.use(auth.loadUser);

	api.get("/health", (req, res) => {
		res.json({ status: "ok" });
	});

	api.post("/messages", limiter(config.createLimit), (req, res) => {
		const input = parseCreateRequest(req.body, config);
		const createdAt = Date.now();
		const message = {
			...input,
			createdAt,
			expiresAt: createdAt + input.expiresIn * 1000,
			// Signed-in users own what they create, so it shows up in their history
			ownerId: req.user?.id,
		};

		if (input.alias) {
			if (!store.insert({ ...message, id: input.alias })) {
				throw new ApiError(409, "already_exists", "A message with this alias already exists.");
			}
			return res.status(201).json({ id: input.alias });
		}

		// Collisions are astronomically unlikely with 62^10 ids, but retry anyway
		for (let attempt = 0; attempt < 5; attempt++) {
			const id = generateId();
			if (store.insert({ ...message, id })) return res.status(201).json({ id });
		}
		throw new Error("Unable to generate a unique message id.");
	});

	api.get("/messages/:id", (req, res) => {
		const metadata = store.getMetadata(requireId(req.params.id));
		if (!metadata) throw new ApiError(404, "not_found", "This message does not exist, or has expired.");
		res.json(metadata);
	});

	api.post("/messages/:id/open", limiter(config.openLimit), (req, res) => {
		const id = requireId(req.params.id);
		const authToken = req.body?.authToken;
		if (typeof authToken !== "string" || !BASE64URL_PATTERN.test(authToken) || authToken.length > 128) {
			throw new ApiError(400, "invalid_request", "authToken must be a base64url string.");
		}

		const result = store.open(id, sha256Hex(authToken), config.maxFailedAttempts);

		switch (result.status) {
			case "not_found":
				throw new ApiError(404, "not_found", "This message does not exist, or has expired.");
			case "unauthorized":
				throw new ApiError(
					403,
					"unauthorized",
					result.attemptsLeft > 0
						? "Invalid password or link."
						: "Too many failed attempts. This message has been destroyed.",
					{ attemptsLeft: result.attemptsLeft }
				);
			default: {
				const { status, ...message } = result;
				res.json(message);
			}
		}
	});

	/* ---------- Accounts ---------- */

	api.get("/session", (req, res) => {
		res.json({
			accounts: { enabled: auth.enabled, provider: auth.providerName },
			user: req.user ?? null,
		});
	});

	const account = express.Router();
	account.use(limiter(config.accountLimit), (req, res, next) => {
		if (!req.user) throw new ApiError(401, "unauthenticated", "Please sign in first.");

		// The session cookie is SameSite=Lax; also refuse writes from other origins outright
		const origin = req.get("origin");
		if (req.method !== "GET" && origin && origin !== auth.publicOrigin(req)) {
			throw new ApiError(403, "forbidden", "Cross-origin requests are not allowed.");
		}
		next();
	});

	account.post("/logout", auth.logout);

	account.put("/vault", (req, res) => {
		const { salt, key, reset } = parseVaultRequest(req.body);
		store.setVault(req.user.id, salt, key, { reset });
		res.json(store.getUser(req.user.id));
	});

	account.delete("/", (req, res) => {
		store.deleteUser(req.user.id);
		auth.logout(req, res);
	});

	const ownedNotFound = () => new ApiError(404, "not_found", "This message does not exist in your account.");

	account.get("/messages", (req, res) => {
		res.json(store.listOwned(req.user.id));
	});

	account.get("/messages/:id", (req, res) => {
		const message = store.getOwned(req.user.id, requireId(req.params.id));
		if (!message) throw ownedNotFound();
		res.json(message);
	});

	account.patch("/messages/:id", (req, res) => {
		const result = store.updateOwned(req.user.id, requireId(req.params.id), parseUpdateRequest(req.body, config));
		switch (result.status) {
			case "not_found":
				throw ownedNotFound();
			case "burned":
				throw new ApiError(409, "burned", "This message has already been destroyed.");
			case "invalid_views":
				throw new ApiError(
					400,
					"invalid_views",
					`It has already been viewed ${result.views} time(s). Allow more views than that, or 0 for unlimited.`
				);
			default:
				res.json(result.message);
		}
	});

	account.post("/messages/:id/revoke", (req, res) => {
		const id = requireId(req.params.id);
		if (!store.revokeOwned(req.user.id, id)) {
			throw new ApiError(409, "burned", "This message does not exist or has already been destroyed.");
		}
		res.json(store.getOwned(req.user.id, id));
	});

	account.delete("/messages/:id", (req, res) => {
		if (!store.deleteOwned(req.user.id, requireId(req.params.id))) throw ownedNotFound();
		res.status(204).end();
	});

	api.use("/account", account);

	api.use((req, res) => {
		res.status(404).json({ error: "Not found.", type: "not_found" });
	});

	app.use("/api", api);
	app.use("/auth", auth.loadUser, auth.router);

	// Client app (production build). In development, `ng serve` proxies /api here instead.
	const indexFile = path.join(config.staticDir, "index.html");
	if (existsSync(indexFile)) {
		app.use(express.static(config.staticDir, { index: false }));
		app.get("/{*path}", (req, res) => res.sendFile(indexFile));
	}

	// eslint-disable-next-line no-unused-vars
	app.use((error, req, res, next) => {
		if (error instanceof ApiError) {
			return res.status(error.status).json({ error: error.message, type: error.type, ...error.extra });
		}
		// Errors raised by express.json() (malformed JSON, oversized body)
		if (error.type === "entity.too.large") {
			return res.status(413).json({ error: "Message is too large.", type: "message_too_large" });
		}
		if (error.status >= 400 && error.status < 500) {
			return res.status(error.status).json({ error: "Invalid request.", type: "invalid_request" });
		}

		console.error(error);
		res.status(500).json({ error: "Internal server error.", type: "internal_error" });
	});

	return app;
}
