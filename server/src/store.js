import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { timingSafeEqual } from "node:crypto";

const SCHEMA = `
	CREATE TABLE IF NOT EXISTS users (
		id            TEXT    PRIMARY KEY,
		issuer        TEXT    NOT NULL,
		subject       TEXT    NOT NULL,
		name          TEXT    NOT NULL,
		email         TEXT    NOT NULL,
		vault_salt    TEXT,
		vault_key     TEXT,
		created_at    INTEGER NOT NULL,
		last_login_at INTEGER NOT NULL,
		UNIQUE (issuer, subject)
	) STRICT;

	CREATE TABLE IF NOT EXISTS sessions (
		token_hash TEXT    PRIMARY KEY,
		user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
		expires_at INTEGER NOT NULL
	) STRICT;

	CREATE TABLE IF NOT EXISTS login_states (
		state      TEXT    PRIMARY KEY,
		verifier   TEXT    NOT NULL,
		nonce      TEXT    NOT NULL,
		return_to  TEXT    NOT NULL,
		expires_at INTEGER NOT NULL
	) STRICT;

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
		expires_at      INTEGER NOT NULL,
		owner_id        TEXT    REFERENCES users (id) ON DELETE CASCADE,
		owner_blob      TEXT,
		burned_at       INTEGER,
		burn_reason     TEXT
	) STRICT;

	CREATE INDEX IF NOT EXISTS messages_expires_at ON messages (expires_at);
	CREATE INDEX IF NOT EXISTS messages_owner_id ON messages (owner_id, created_at);
	CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions (user_id);
`;

// Databases created before accounts existed only need the owner columns
const ACCOUNT_COLUMNS = [
	"owner_id TEXT REFERENCES users (id) ON DELETE CASCADE",
	"owner_blob TEXT",
	"burned_at INTEGER",
	"burn_reason TEXT",
];

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
 *
 * Messages without an owner are deleted the moment they burn. Messages that belong
 * to an account are reduced to a tombstone instead: the ciphertext, access hash and
 * the owner's key copy are wiped, and only the bookkeeping is kept for their history.
 */
export class Store {
	#db;
	#statements;

	constructor(file) {
		if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });

		this.#db = new DatabaseSync(file);
		// Overwrite deleted content with zeros instead of leaving it in free pages
		this.#db.exec("PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
		this.#upgradeMessagesTable();
		this.#db.exec(SCHEMA);

		const prepare = (sql) => this.#db.prepare(sql);
		this.#statements = {
			insert: prepare(`
				INSERT INTO messages (id, ciphertext, auth_hash, use_password, nocopy, max_views, created_at, expires_at, owner_id, owner_blob)
				VALUES (:id, :ciphertext, :authHash, :usePassword, :nocopy, :maxViews, :createdAt, :expiresAt, :ownerId, :ownerBlob)
				ON CONFLICT (id) DO NOTHING
			`),
			find: prepare("SELECT * FROM messages WHERE id = ?"),
			delete: prepare("DELETE FROM messages WHERE id = ?"),
			tombstone: prepare(`
				UPDATE messages SET ciphertext = '', auth_hash = '', owner_blob = NULL, burned_at = :now, burn_reason = :reason
				WHERE id = :id
			`),
			addView: prepare("UPDATE messages SET views = views + 1 WHERE id = ?"),
			addFailure: prepare("UPDATE messages SET failed_attempts = failed_attempts + 1 WHERE id = ?"),
			update: prepare(`
				UPDATE messages SET
					ciphertext = :ciphertext, auth_hash = :authHash, use_password = :usePassword, nocopy = :nocopy,
					max_views = :maxViews, expires_at = :expiresAt, owner_blob = :ownerBlob, failed_attempts = :failedAttempts
				WHERE id = :id
			`),

			purgeUnowned: prepare("DELETE FROM messages WHERE owner_id IS NULL AND expires_at <= ?"),
			expireOwned: prepare(`
				UPDATE messages SET ciphertext = '', auth_hash = '', owner_blob = NULL, burned_at = expires_at, burn_reason = 'expired'
				WHERE owner_id IS NOT NULL AND burned_at IS NULL AND expires_at <= ?
			`),
			purgeHistory: prepare("DELETE FROM messages WHERE burned_at IS NOT NULL AND burned_at <= ?"),
			purgeSessions: prepare("DELETE FROM sessions WHERE expires_at <= ?"),
			purgeLoginStates: prepare("DELETE FROM login_states WHERE expires_at <= ?"),

			listOwned: prepare("SELECT * FROM messages WHERE owner_id = ? ORDER BY created_at DESC, id"),
			findOwned: prepare("SELECT * FROM messages WHERE id = ? AND owner_id = ?"),
			deleteOwned: prepare("DELETE FROM messages WHERE id = ? AND owner_id = ?"),
			clearOwnerBlobs: prepare("UPDATE messages SET owner_blob = NULL WHERE owner_id = ?"),

			findUser: prepare("SELECT * FROM users WHERE id = ?"),
			findUserBySubject: prepare("SELECT * FROM users WHERE issuer = ? AND subject = ?"),
			insertUser: prepare(`
				INSERT INTO users (id, issuer, subject, name, email, created_at, last_login_at)
				VALUES (:id, :issuer, :subject, :name, :email, :now, :now)
			`),
			updateUserLogin: prepare("UPDATE users SET name = :name, email = :email, last_login_at = :now WHERE id = :id"),
			setVault: prepare("UPDATE users SET vault_salt = :salt, vault_key = :key WHERE id = :id"),
			deleteUser: prepare("DELETE FROM users WHERE id = ?"),

			insertSession: prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
			findSessionUser: prepare(`
				SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
				WHERE sessions.token_hash = ? AND sessions.expires_at > ?
			`),
			deleteSession: prepare("DELETE FROM sessions WHERE token_hash = ?"),

			insertLoginState: prepare(`
				INSERT INTO login_states (state, verifier, nonce, return_to, expires_at)
				VALUES (:state, :verifier, :nonce, :returnTo, :expiresAt)
			`),
			findLoginState: prepare("SELECT * FROM login_states WHERE state = ? AND expires_at > ?"),
			deleteLoginState: prepare("DELETE FROM login_states WHERE state = ?"),
		};
	}

	/* ---------- Messages (public) ---------- */

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
			ownerId: message.ownerId ?? null,
			ownerBlob: message.ownerId ? (message.ownerBlob ?? null) : null,
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
	 * The message is destroyed in the same transaction that serves its last view.
	 */
	open(id, authHash, maxFailedAttempts, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#findLive(id, now);
			if (!row) return { status: "not_found" };

			if (!hashesEqual(row.auth_hash, authHash)) {
				const failedAttempts = row.failed_attempts + 1;
				const attemptsLeft = Math.max(maxFailedAttempts - failedAttempts, 0);

				if (attemptsLeft === 0) this.#destroy(row, "attempts", now);
				else this.#statements.addFailure.run(id);

				return { status: "unauthorized", attemptsLeft };
			}

			const views = row.views + 1;
			const burned = row.max_views > 0 && views >= row.max_views;

			this.#statements.addView.run(id);
			if (burned) this.#destroy(row, "read", now);

			return {
				status: "ok",
				ciphertext: row.ciphertext,
				burned,
				...toMetadata({ ...row, views }),
			};
		});
	}

	/**
	 * Deletes expired anonymous messages, turns expired owned ones into tombstones,
	 * and drops tombstones, sessions and login attempts that are past their retention.
	 * Returns the number of messages removed or burned.
	 */
	purgeExpired(now = Date.now(), historyMs = 30 * 86_400_000) {
		return this.#transaction(() => {
			const removed =
				Number(this.#statements.purgeUnowned.run(now).changes) + Number(this.#statements.expireOwned.run(now).changes);
			this.#statements.purgeHistory.run(now - historyMs);
			this.#statements.purgeSessions.run(now);
			this.#statements.purgeLoginStates.run(now);
			return removed;
		});
	}

	/* ---------- Messages (owner) ---------- */

	listOwned(userId, now = Date.now()) {
		return this.#transaction(() => {
			this.#statements.expireOwned.run(now);
			return this.#statements.listOwned.all(userId).map(toOwned);
		});
	}

	/** Includes the ciphertext while the message is live. Never counts a view. */
	getOwned(userId, id, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#findOwned(userId, id, now);
			return row && { ...toOwned(row), ciphertext: row.burned_at === null ? row.ciphertext : null };
		});
	}

	/**
	 * Applies the given changes to a live owned message.
	 * Returns { status: "ok", message } | { status: "not_found" } | { status: "burned" } | { status: "invalid_views" }.
	 */
	updateOwned(userId, id, changes, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#findOwned(userId, id, now);
			if (!row) return { status: "not_found" };
			if (row.burned_at !== null) return { status: "burned" };

			const maxViews = changes.maxViews ?? row.max_views;
			if (maxViews !== 0 && maxViews <= row.views) return { status: "invalid_views", views: row.views };

			const authHash = changes.authHash ?? row.auth_hash;
			this.#statements.update.run({
				id,
				ciphertext: changes.ciphertext ?? row.ciphertext,
				authHash,
				usePassword: (changes.usePassword ?? row.use_password === 1) ? 1 : 0,
				nocopy: (changes.nocopy ?? row.nocopy === 1) ? 1 : 0,
				maxViews,
				expiresAt: changes.expiresAt ?? row.expires_at,
				ownerBlob: changes.ownerBlob === undefined ? row.owner_blob : changes.ownerBlob,
				// A new key means the old failed guesses were against a different secret
				failedAttempts: authHash === row.auth_hash ? row.failed_attempts : 0,
			});

			return { status: "ok", message: toOwned(this.#statements.find.get(id)) };
		});
	}

	/** Destroys a live owned message right away. Returns false if it doesn't exist or already burned. */
	revokeOwned(userId, id, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#findOwned(userId, id, now);
			if (!row || row.burned_at !== null) return false;
			this.#destroy(row, "revoked", now);
			return true;
		});
	}

	/** Removes a message (live or burned) and its history entry entirely. */
	deleteOwned(userId, id) {
		return Number(this.#statements.deleteOwned.run(id, userId).changes) === 1;
	}

	/* ---------- Users and sessions ---------- */

	/** Finds or creates the account for an identity provider subject. */
	upsertUser({ id, issuer, subject, name, email }, now = Date.now()) {
		return this.#transaction(() => {
			const existing = this.#statements.findUserBySubject.get(issuer, subject);
			if (existing) {
				this.#statements.updateUserLogin.run({ id: existing.id, name, email, now });
				return toUser({ ...existing, name, email });
			}
			this.#statements.insertUser.run({ id, issuer, subject, name, email, now });
			return toUser(this.#statements.findUser.get(id));
		});
	}

	getUser(id) {
		const row = this.#statements.findUser.get(id);
		return row && toUser(row);
	}

	/** Stores the user's wrapped vault key. A reset also forgets every key copy made with the old vault. */
	setVault(userId, salt, key, { reset = false } = {}) {
		this.#transaction(() => {
			this.#statements.setVault.run({ id: userId, salt, key });
			if (reset) this.#statements.clearOwnerBlobs.run(userId);
		});
	}

	/** Deletes the account, its sessions, and every message it owns. */
	deleteUser(userId) {
		this.#statements.deleteUser.run(userId);
	}

	createSession(tokenHash, userId, expiresAt) {
		this.#statements.insertSession.run(tokenHash, userId, expiresAt);
	}

	findSessionUser(tokenHash, now = Date.now()) {
		const row = this.#statements.findSessionUser.get(tokenHash, now);
		return row && toUser(row);
	}

	deleteSession(tokenHash) {
		this.#statements.deleteSession.run(tokenHash);
	}

	saveLoginState(loginState) {
		this.#statements.insertLoginState.run(loginState);
	}

	/** Returns and deletes a pending login, so each one can only be completed once. */
	takeLoginState(state, now = Date.now()) {
		return this.#transaction(() => {
			const row = this.#statements.findLoginState.get(state, now);
			this.#statements.deleteLoginState.run(state);
			return row && { verifier: row.verifier, nonce: row.nonce, returnTo: row.return_to };
		});
	}

	close() {
		this.#db.close();
	}

	/* ---------- Internals ---------- */

	#findLive(id, now) {
		const row = this.#statements.find.get(id);
		if (!row || row.burned_at !== null) return undefined;

		if (row.expires_at <= now) {
			this.#destroy(row, "expired", row.expires_at);
			return undefined;
		}
		if (row.max_views > 0 && row.views >= row.max_views) {
			this.#destroy(row, "read", now);
			return undefined;
		}

		return row;
	}

	/** Like #findLive, but keeps tombstones and only matches the owner's messages. */
	#findOwned(userId, id, now) {
		const row = this.#statements.findOwned.get(id, userId);
		if (!row || row.burned_at !== null) return row;
		return this.#findLive(id, now) ?? this.#statements.findOwned.get(id, userId);
	}

	#destroy(row, reason, now) {
		if (row.owner_id === null) this.#statements.delete.run(row.id);
		else this.#statements.tombstone.run({ id: row.id, reason, now });
	}

	#upgradeMessagesTable() {
		const columns = this.#db.prepare("SELECT name FROM pragma_table_info('messages')").all();
		if (columns.length === 0 || columns.some((column) => column.name === "owner_id")) return;
		for (const column of ACCOUNT_COLUMNS) this.#db.exec(`ALTER TABLE messages ADD COLUMN ${column}`);
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

const iso = (ms) => new Date(ms).toISOString();

const toMetadata = (row) => ({
	usePassword: row.use_password === 1,
	nocopy: row.nocopy === 1,
	maxViews: row.max_views,
	views: row.views,
	expiresAt: iso(row.expires_at),
});

const toOwned = (row) => ({
	id: row.id,
	...toMetadata(row),
	failedAttempts: row.failed_attempts,
	createdAt: iso(row.created_at),
	ownerBlob: row.owner_blob,
	burnedAt: row.burned_at === null ? null : iso(row.burned_at),
	burnReason: row.burn_reason,
});

const toUser = (row) => ({
	id: row.id,
	name: row.name,
	email: row.email,
	vault: row.vault_key ? { salt: row.vault_salt, key: row.vault_key } : null,
});
