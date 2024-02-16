// Router
const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");
const nocache = require("nocache");
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(nocache());

// Crypto JS
const CryptoJS = require("crypto-js");

// DayJS
const dayjs = require("dayjs");

// For generating random ID
const { randomUUID } = require("crypto");

// Database
const { JsonDB, Config } = require("node-json-db");

// Initialize database
const db = new JsonDB(
	new Config(
		"database/messages" /* Database name */,
		true /* Automatically save after push() */,
		true /* Human readable database */,
		"/" /* Database separator */
	)
);

// Misc configuration
const encryptionSalt = process.env.ENCRYPTION_SALT || "NlBK7TgXLpQZ7JbnKSy2nxafGEkyhBpHCmzWGJNz";

const port = 80;

// Misc function
encryptMessage = (message, passphrase) => {
	if (!message) message = "";

	const encryptionKey = passphrase + encryptionSalt;
	return CryptoJS.AES.encrypt(message, encryptionKey).toString();
};

decryptMessage = (input, passphrase) => {
	const encryptionKey = passphrase + encryptionSalt;

	return CryptoJS.AES.decrypt(input, encryptionKey).toString(CryptoJS.enc.Utf8);
};
/**
 * Main Route
 */
app.get("/__api", (req, res) => {
	res.send({ message: "Success.", code: 200 });
});

app.get("/__api/Messages/:messageId", async (req, res) => {
	const messageId = req.params.messageId;
	const password = req.headers.authorization || "";
	const preflight = !!req.headers.preflight;

	try {
		// Fetch doc
		const doc = await db.getData("/" + messageId);

		// To write back to the database to increase view count
		const originalContent = doc.content;

		// Check if views exceeds maxViews
		if (doc.views >= doc.maxViews) {
			// Remove the document from database
			await db.delete("/" + messageId);
			throw {
				error: "This document has reached its view limit.",
				type: "document_expired_by_view",
				code: 400,
			};
		}

		// Check if the message has expired
		const expiresAt = new Date(doc.expiresAt);
		const now = new Date();
		if (expiresAt < now) {
			// Remove the document from database
			await db.delete("/" + messageId);
			throw {
				error: "This document has expired.",
				type: "document_expired_by_time",
				code: 400,
			};
		}

		// If pre-flight, do not return content
		// Pre-flight simply checks if the document exists and hasn't expired
		// Before increasing the view count
		if (preflight) {
			res.status(200).send({
				...doc,
				content: "",
			});
			return;
		}

		if (doc.usePassword) {
			let content = decryptMessage(originalContent, password);

			if (content.length === 0) {
				res.status(400).send({
					error: "Invalid password.",
					type: "invalid_password",
					code: 400,
				});

				return;
			}
			doc.content = content;
		}

		// Increase the view count
		const newData = {
			...doc,
			content: originalContent,
			views: parseInt(doc.views) + 1,
		};
		await db.push("/" + messageId, newData);

		res.send(doc);
	} catch (error) {
		if (error.type === "document_already_exists") {
			res.status(400).send({
				error: "Document has already existed.",
				type: error.type,
				code: error.code,
			});

			return;
		}

		// Error: Malformed UTF-8 data = wrong password
		console.log(error);
		if (error.toString().toLowerCase().includes("malformed")) {
			res.status(400).send({
				error: "Invalid password.",
				type: "invalid_password",
				code: 400,
			});
			return;
		}

		res.status(400).send(error);
	}
});

app.post("/__api/Messages", async (req, res) => {
	const messageId = req.body.alias || randomUUID().replaceAll("-", "");
	const password = req.body.password || "";
	const maxViews = req.body.maxViews !== undefined ? req.body.maxViews : 1;
	const nocopy = req.body.nocopy !== undefined ? !!req.body.nocopy : false;
	const content = req.body.content || "";
	const expiresAt = req.body.expiresAt || dayjs().add(3, "days").toDate();

	// Disallow empty content so it doesn't conflict with "" with encryption
	if (content === "") {
		res.status(400).send({
			error: "Message cannot be empty.",
			type: "invalid_message_length",
			code: 400,
		});
		return;
	}

	let data = {
		maxViews,
		views: 0,
		nocopy,
		usePassword: password.toString().length > 0 ? true : false,
		content:
			password.toString().length > 0
				? encryptMessage(content, password) // Encrypt content if password is used
				: content,
		expiresAt,
	};

	try {
		// Helper function to check if the messageId already exists in the database
		const docExists = (documentId) => {
			return new Promise(async (resolve) => {
				try {
					await db.getData("/" + documentId);

					// No error, meaning the message with this messageId already existed
					resolve(true);
				} catch (error) {
					// Error means the message does not exist, can proceed
					resolve(false);
				}
			});
		};

		// Check for existed documents
		const exists = await docExists(messageId);

		if (exists) {
			throw {
				error: "Document has already existed.",
				type: "document_already_exists",
				code: 400,
			};
		}

		// Save the new data
		await db.push("/" + messageId, data);

		res.send({
			...data,
			$id: messageId,
		});
	} catch (error) {
		if (error.type === "document_already_exists") {
			res.status(400).send({
				error: "Document has already existed.",
				type: error.type,
				code: error.code,
			});

			return;
		}

		res.send(error);
	}
});

// Client apps - production only
// Must include all the routes fron Angular
app.use("/", express.static(__dirname + "/dist"));
app.use("/create", express.static(__dirname + "/dist"));
app.use("/v/*", express.static(__dirname + "/dist"));

app.listen(port, () => {
	console.log(`Burnit server is running on port ${port}`);
});
