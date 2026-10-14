import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.dbFile);
const app = createApp({ store, config });

const { issuer, clientId, clientSecret } = config.oidc;
if (issuer && !(clientId && clientSecret)) {
	console.warn("OIDC_ISSUER is set, but OIDC_CLIENT_ID or OIDC_CLIENT_SECRET is missing; sign-in is disabled.");
}

// Expired messages are also rejected on access; this makes sure they don't linger on disk
const purge = () => {
	try {
		const removed = store.purgeExpired(Date.now(), config.historyDays * 86_400_000);
		if (removed > 0) console.log(`Purged ${removed} expired message(s).`);
	} catch (error) {
		console.error("Failed to purge expired messages:", error);
	}
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
