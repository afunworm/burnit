import { decrypt, deriveKeys, encrypt, fromBase64Url, generateSecret, hashAuthToken, toBase64Url } from "./crypto";

describe("crypto", () => {
	it("round-trips base64url", () => {
		const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
	});

	it("encrypts and decrypts with the same secret and password", async () => {
		const secret = generateSecret();
		const sender = await deriveKeys(secret, "hunter2");
		const receiver = await deriveKeys(secret, "hunter2");

		const payload = await encrypt(sender.encryptionKey, "top secret 🔥");
		expect(receiver.authToken).toBe(sender.authToken);
		expect(await decrypt(receiver.encryptionKey, payload)).toBe("top secret 🔥");
	});

	it("derives a different token and key for a wrong password or secret", async () => {
		const secret = generateSecret();
		const right = await deriveKeys(secret, "hunter2");
		const wrongPassword = await deriveKeys(secret, "hunter3");
		const wrongSecret = await deriveKeys(generateSecret(), "hunter2");

		expect(wrongPassword.authToken).not.toBe(right.authToken);
		expect(wrongSecret.authToken).not.toBe(right.authToken);

		const payload = await encrypt(right.encryptionKey, "x");
		await expect(decrypt(wrongPassword.encryptionKey, payload)).rejects.toThrow();
	});

	it("hashes the token as lowercase hex SHA-256", async () => {
		expect(await hashAuthToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
});
