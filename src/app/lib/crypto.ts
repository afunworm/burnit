/**
 * End-to-end encryption for messages.
 *
 * Every message gets a random 256-bit secret that only ever lives in the URL fragment
 * (`/v/<id>#<secret>`), which browsers never send to the server. When a password is
 * set, it is stretched with PBKDF2 using the secret as salt, so the server (or anyone
 * holding a database copy) can't brute-force it without the link.
 *
 * Two independent keys are derived with HKDF:
 * - an AES-256-GCM key that encrypts the content and never leaves the browser
 * - an access token that proves knowledge of the secret (and password). The server only
 *   stores its SHA-256 hash, and won't release the ciphertext or count a view without it.
 */

const PBKDF2_ITERATIONS = 600_000;
const SECRET_BYTES = 32;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface MessageKeys {
	encryptionKey: CryptoKey;
	authToken: string;
}

export function isCryptoAvailable(): boolean {
	return globalThis.isSecureContext !== false && !!globalThis.crypto?.subtle;
}

export function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url string.");

	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function generateSecret(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

export async function deriveKeys(secret: string, password: string): Promise<MessageKeys> {
	const secretBytes = fromBase64Url(secret);
	if (secretBytes.length !== SECRET_BYTES) throw new Error("Invalid message secret.");

	let keyMaterial = secretBytes;
	if (password) {
		const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
			"deriveBits",
		]);
		const stretched = await crypto.subtle.deriveBits(
			{ name: "PBKDF2", hash: "SHA-256", salt: secretBytes, iterations: PBKDF2_ITERATIONS },
			passwordKey,
			256
		);
		keyMaterial = new Uint8Array(stretched);
	}

	const baseKey = await crypto.subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveKey", "deriveBits"]);
	const hkdf = (info: string): HkdfParams => ({
		name: "HKDF",
		hash: "SHA-256",
		salt: new Uint8Array(0),
		info: encoder.encode(info),
	});

	const encryptionKey = await crypto.subtle.deriveKey(
		hkdf("burnit/v1/encryption"),
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
	const authBits = await crypto.subtle.deriveBits(hkdf("burnit/v1/auth"), baseKey, 256);

	return { encryptionKey, authToken: toBase64Url(new Uint8Array(authBits)) };
}

/** SHA-256 of the token, hex encoded. This is all the server stores. */
export async function hashAuthToken(authToken: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(authToken)));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Returns base64url(iv || ciphertext || tag). */
export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext)));

	const payload = new Uint8Array(IV_BYTES + ciphertext.length);
	payload.set(iv);
	payload.set(ciphertext, IV_BYTES);
	return toBase64Url(payload);
}

export async function decrypt(key: CryptoKey, payload: string): Promise<string> {
	const bytes = fromBase64Url(payload);
	const iv = bytes.slice(0, IV_BYTES);
	const ciphertext = bytes.slice(IV_BYTES);
	return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
}
