import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MessageStore } from "./store.js";

const config = loadConfig();
const store = new MessageStore(config.dbFile);
const app = createApp({ store, config });

// Expired messages are also rejected on access; this makes sure they don't linger on disk
const purge = () => {
	try {
		const removed = store.purgeExpired();
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
