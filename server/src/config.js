import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const int = (name, fallback) => {
	const value = process.env[name];
	if (value === undefined || value === "") return fallback;

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`Environment variable ${name} must be a non-negative integer.`);
	}
	return parsed;
};

// "true"/"false", a hop count, or a comma-separated list of trusted proxy addresses
const trustProxy = (value) => {
	if (value === undefined || value === "" || value === "false") return false;
	if (value === "true") return true;
	if (/^\d+$/.test(value)) return Number(value);
	return value.split(",").map((part) => part.trim());
};

export function loadConfig() {
	const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));

	return {
		port: int("PORT", 3000),
		dbFile: process.env.DB_FILE || path.join(dataDir, "burnit.db"),
		staticDir: path.resolve(process.env.STATIC_DIR || path.join(rootDir, "public")),
		trustProxy: trustProxy(process.env.TRUST_PROXY),

		// Limits enforced on every message, regardless of what the client asks for
		maxTtlSeconds: int("MAX_TTL_DAYS", 366) * 24 * 60 * 60,
		maxViews: int("MAX_VIEWS", 10000),
		maxMessageBytes: int("MAX_MESSAGE_KB", 512) * 1024,
		maxFailedAttempts: int("MAX_FAILED_ATTEMPTS", 10),

		// Per-IP rate limits, per 15 minutes
		createLimit: int("RATE_LIMIT_CREATE", 30),
		openLimit: int("RATE_LIMIT_OPEN", 60),
		accountLimit: int("RATE_LIMIT_ACCOUNT", 600),

		purgeIntervalMs: 60 * 1000,

		// Optional sign-in through an OpenID Connect provider such as PocketID
		oidc: {
			issuer: process.env.OIDC_ISSUER || "",
			clientId: process.env.OIDC_CLIENT_ID || "",
			clientSecret: process.env.OIDC_CLIENT_SECRET || "",
			providerName: process.env.OIDC_PROVIDER_NAME || "PocketID",
		},
		// Public origin, e.g. https://burnit.example.com. Derived from the request when unset.
		publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
		sessionDays: int("SESSION_DAYS", 30),
		// How long burned messages stay in their owner's history
		historyDays: int("HISTORY_DAYS", 30),
	};
}
