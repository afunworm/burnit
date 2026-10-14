/**
 * The account vault keeps the owner's copy of each message key.
 *
 * A random 256-bit vault key is generated in the browser and stored on the server only
 * wrapped (AES-256-GCM) with a key stretched from the user's vault passphrase (PBKDF2-SHA256,
 * 600k iterations). Each owned message carries an "owner record" (its link secret, password
 * and a short preview) sealed with the vault key, so the server, which never sees the
 * passphrase, can't read messages any more than it could without accounts.
 *
 * Once unlocked, the vault key is imported as a non-extractable CryptoKey and cached in
 * IndexedDB, so the passphrase is needed once per device rather than on every visit.
 */
import { decrypt, encrypt, fromBase64Url, toBase64Url } from "./crypto";

const PBKDF2_ITERATIONS = 600_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const PREVIEW_LENGTH = 80;

const encoder = new TextEncoder();

/** What the server stores: the PBKDF2 salt and the wrapped vault key. */
export interface WrappedVault {
	salt: string;
	key: string;
}

export interface OwnerRecord {
	/** The link secret (the part after #) */
	secret: string;
	password: string;
	preview: string;
}

export const previewOf = (content: string) => content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH);

async function wrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
		material,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

const importVaultKey = (raw: Uint8Array<ArrayBuffer>) =>
	crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

async function wrap(raw: Uint8Array<ArrayBuffer>, passphrase: string): Promise<WrappedVault> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	return { salt: toBase64Url(salt), key: await encrypt(await wrappingKey(passphrase, salt), toBase64Url(raw)) };
}

/** Throws if the passphrase is wrong (AES-GCM authentication fails). */
async function unwrap(vault: WrappedVault, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
	const raw = fromBase64Url(await decrypt(await wrappingKey(passphrase, fromBase64Url(vault.salt)), vault.key));
	if (raw.length !== KEY_BYTES) throw new Error("Invalid vault key.");
	return raw;
}

export async function createVault(passphrase: string): Promise<{ wrapped: WrappedVault; key: CryptoKey }> {
	const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
	return { wrapped: await wrap(raw, passphrase), key: await importVaultKey(raw) };
}

export async function unlockVault(vault: WrappedVault, passphrase: string): Promise<CryptoKey> {
	return importVaultKey(await unwrap(vault, passphrase));
}

/** Re-wraps the same vault key under a new passphrase, so existing records stay readable. */
export async function rewrapVault(vault: WrappedVault, oldPassphrase: string, newPassphrase: string): Promise<WrappedVault> {
	return wrap(await unwrap(vault, oldPassphrase), newPassphrase);
}

export function sealRecord(key: CryptoKey, record: OwnerRecord): Promise<string> {
	return encrypt(key, JSON.stringify(record));
}

export async function openRecord(key: CryptoKey, blob: string): Promise<OwnerRecord> {
	return JSON.parse(await decrypt(key, blob)) as OwnerRecord;
}

/* ---------- Per-device cache ---------- */

const DB_NAME = "burnit";
const STORE_NAME = "vault";

interface CachedVault {
	userId: string;
	/** The wrapped key it was unlocked from; a reset on another device makes the cache stale */
	wrappedKey: string;
	key: CryptoKey;
}

function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(DB_NAME, 1);
		open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const db = open.result;
			const request = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
			request.onsuccess = () => {
				resolve(request.result);
				db.close();
			};
			request.onerror = () => {
				reject(request.error);
				db.close();
			};
		};
	});
}

/** Storage can be unavailable (private windows, blocked site data); the vault then just stays locked. */
export async function rememberVaultKey(userId: string, wrapped: WrappedVault, key: CryptoKey): Promise<void> {
	try {
		const value: CachedVault = { userId, wrappedKey: wrapped.key, key };
		await withStore("readwrite", (store) => store.put(value, "current"));
	} catch {
		// Not cached; the passphrase will be asked again next time
	}
}

export async function recallVaultKey(userId: string, wrapped: WrappedVault): Promise<CryptoKey | null> {
	try {
		const cached = await withStore<CachedVault | undefined>("readonly", (store) => store.get("current"));
		return cached && cached.userId === userId && cached.wrappedKey === wrapped.key ? cached.key : null;
	} catch {
		return null;
	}
}

export async function forgetVaultKey(): Promise<void> {
	try {
		await withStore("readwrite", (store) => store.delete("current"));
	} catch {
		// Nothing cached
	}
}
