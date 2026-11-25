import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Encrypts server-side secrets (such as the shortener's API key) before they go into the
 * database, with AES-256-GCM. A database copy or backup alone doesn't reveal them.
 */
export function createSecretBox(key) {
	if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("The secret key must be 32 bytes.");
	return {
		seal(plaintext) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
			return ["v1", iv, cipher.getAuthTag(), data].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
		},
		/** Returns undefined if it can't be opened, e.g. after the secret key changed. */
		open(sealed) {
			const [version, iv, tag, data] = String(sealed).split(".");
			if (version !== "v1" || !iv || !tag || data === undefined) return undefined;
			try {
				const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
				decipher.setAuthTag(Buffer.from(tag, "base64url"));
				return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
			} catch {
				return undefined;
			}
		},
	};
}

/**
 * The key comes from SECRET_KEY (64 hex characters or base64 of 32 bytes). Without it, one is
 * generated once and kept in `file`, next to the database.
 */
export function loadSecretKey({ value, file }) {
	if (value) {
		const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
		if (key.length !== 32) throw new Error("SECRET_KEY must be 32 bytes: 64 hex characters, or base64.");
		return key;
	}
	if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8").trim(), "base64");

	const key = randomBytes(32);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, key.toString("base64"), { mode: 0o600 });
	return key;
}
