import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { createShortener } from "./shortener.js";
import { createSecretBox, loadSecretKey } from "./secret-box.js";

const config = loadConfig();
const store = new Store(config.dbFile);
const secretBox = createSecretBox(loadSecretKey({ value: config.secretKey, file: config.secretKeyFile }));
const shortener = createShortener({ store, secretBox });
const app = createApp({ store, config, shortener });

const { issuer, clientId, clientSecret } = config.oidc;
if (issuer && !(clientId && clientSecret)) {
	console.warn("OIDC_ISSUER is set, but OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is missing; sign-in is disabled.");
}
if (config.adminEmails.length === 0) {
	console.warn("ADMIN_EMAILS is not set; nobody can configure short links.");
}

// Expired messages are also rejected on access; this makes sure they don't linger on disk
const purge = () => {
	try {
		const removed = store.purgeExpired(Date.now(), config.historyDays * 86_400_000);
		if (removed > 0) console.log(`Purged ${removed} expired message(s).`);
	} catch (error) {
		console.error("Failed to purge expired messages:", error);
	}
	// Short links of burned or expired messages are deleted at the shortener, too
	shortener.sweep().catch((error) => console.error("Failed to delete stale short links:", error));
};
purge();
const purgeTimer = setInterval(purge, config.purgeIntervalMs);

const server = app.listen(config.port, () => {
	console.log(`Burnit server is running on port ${config.port}`);
});

const shutdown = () => {
	clearInterval(purgeTimer);
	server.close(() => {
		store.close();
		process.exit(0);
	});
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
