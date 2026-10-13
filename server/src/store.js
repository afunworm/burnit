import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { timingSafeEqual } from "node:crypto";

const SCHEMA = `
	CREATE TABLE IF NOT EXISTS messages (
		id              TEXT    PRIMARY KEY,
		ciphertext      TEXT    NOT NULL,
		auth_hash       TEXT    NOT NULL,
		use_password    INTEGER NOT NULL,
		nocopy          INTEGER NOT NULL,
		max_views       INTEGER NOT NULL,
		views           INTEGER NOT NULL DEFAULT 0,
		failed_attempts INTEGER NOT NULL DEFAULT 0,
		created_at      INTEGER NOT NULL,
		expires_at      INTEGER NOT NULL
	) STRICT;

	CREATE INDEX IF NOT EXISTS messages_expires_at ON messages (expires_at);
`;

const hashesEqual = (a, b) => {
	const left = Buffer.from(a, "hex");
	const right = Buffer.from(b, "hex");
	return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * All methods are synchronous. node:sqlite blocks the event loop for the duration
 * of each call, so a read-check-update sequence can never interleave with another
 * request in this process. Transactions additionally guard against other processes
 * sharing the same database file.
 */
export class MessageStore {
	#db;
	#statements;

	constructor(file) {
		if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });

		this.#db = new DatabaseSync(file);
		// Overwrite deleted content with zeros instead of leaving it in free pages
		this.#db.exec("PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;");
		this.#db.exec(SCHEMA);

		this.#statements = {
			insert: this.#db.prepare(`
				INSERT INTO messages (id, ciphertext, auth_hash, use_password, nocopy, max_views, created_at, expires_at)
				VALUES (:id, :ciphertext, :authHash, :usePassword, :nocopy, :maxViews, :createdAt, :expiresAt)
				ON CONFLICT (id) DO NOTHING
			`),
			find: this.#db.prepare("SELECT * FROM messages WHERE id = ?"),
			delete: this.#db.prepare("DELETE FROM messages WHERE id = ?"),
			addView: this.#db.prepare("UPDATE messages SET views = views + 1 WHERE id = ?"),
			addFailure: this.#db.prepare("UPDATE messages SET failed_attempts = failed_attempts + 1 WHERE id = ?"),
			purge: this.#db.prepare("DELETE FROM messages WHERE expires_at <= ?"),
		};
	}

	/** Returns false if the id is already taken. */
	insert(message) {
		const result = this.#statements.insert.run({
			id: message.id,
			ciphertext: message.ciphertext,
			authHash: message.authHash,
			usePassword: message.usePassword ? 1 : 0,
			nocopy: message.nocopy ? 1 : 0,
			maxViews: message.maxViews,
			createdAt: message.createdAt,
			expiresAt: message.expiresAt,
		});
		return result.changes === 1;
	}

	/** Returns the public metadata of a live message, or undefined. Never returns the ciphertext. */
	getMetadata(id, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#findLive(id, now);
			return row && toMetadata(row);
		});
	}

	/**
	 * Verifies the access token hash and consumes one view.
	 * The message is deleted in the same transaction that serves its last view.
	 */
	open(id, authHash, maxFailedAttempts, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#findLive(id, now);
			if (!row) return { status: "not_found" };

			if (!hashesEqual(row.auth_hash, authHash)) {
				const failedAttempts = row.failed_attempts + 1;
				const attemptsLeft = Math.max(maxFailedAttempts - failedAttempts, 0);

				if (attemptsLeft === 0) this.#statements.delete.run(id);
				else this.#statements.addFailure.run(id);

				return { status: "unauthorized", attemptsLeft };
			}

			const views = row.views + 1;
			const burned = row.max_views > 0 && views >= row.max_views;

			if (burned) this.#statements.delete.run(id);
			else this.#statements.addView.run(id);

			return {
				status: "ok",
				ciphertext: row.ciphertext,
				burned,
				...toMetadata({ ...row, views }),
			};
		});
	}

	/** Deletes every expired message. Returns the number of deleted rows. */
	purgeExpired(now = Date.now()) {
		return Number(this.#statements.purge.run(now).changes);
	}

	close() {
		this.#db.close();
	}

	#findLive(id, now) {
		const row = this.#statements.find.get(id);
		if (!row) return undefined;

		const exhausted = row.max_views > 0 && row.views >= row.max_views;
		if (row.expires_at <= now || exhausted) {
			this.#statements.delete.run(id);
			return undefined;
		}

		return row;
	}

	#transaction(fn) {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			const result = fn();
			this.#db.exec("COMMIT");
			return result;
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}
}

const toMetadata = (row) => ({
	usePassword: row.use_password === 1,
	nocopy: row.nocopy === 1,
	maxViews: row.max_views,
	views: row.views,
	expiresAt: new Date(row.expires_at).toISOString(),
});
