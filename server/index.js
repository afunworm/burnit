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

// ApPWrite
const endpoint = process.env.APPWRITE_ENDPOINT || "";
const project = process.env.APPWRITE_PROJECT || "";
const key = process.env.APPWRITE_KEY || "";

if (!endpoint || !project || !key) {
	console.log(
		"Environment variables APPWRITE_ENDPOINT, APPWRITE_PROJECT and APPWRITE_KEY are required to run the app."
	);
	process.exit();
}

const sdk = require("node-appwrite");
const client = new sdk.Client();
const databases = new sdk.Databases(client);
client.setEndpoint(endpoint).setProject(project).setKey(key);

// Crypto JS
const CryptoJS = require("crypto-js");

// DayJS
const dayjs = require("dayjs");

// Misc configuration
const dbId = "main";
const dbName = "Main";
const messageCollectionId = "messages";
const messageCollectionName = "Messages";
const encryptionSalt =
	process.env.ENCRYPTION_SALT || "NlBK7TgXLpQZ7JbnKSy2nxafGEkyhBpHCmzWGJNz";

const port = 80;

// Misc function
encryptMessage = (message, passphrase) => {
	if (!message) message = "";

	const encryptionKey = passphrase + encryptionSalt;
	return CryptoJS.AES.encrypt(message, encryptionKey).toString();
};

decryptMessage = (input, passphrase) => {
	const encryptionKey = passphrase + encryptionSalt;

	return CryptoJS.AES.decrypt(input, encryptionKey).toString(
		CryptoJS.enc.Utf8
	);
};
/**
 * Main Route
 */
app.get("/install", async (req, res) => {
	try {
		/**
		 * Prepare the database
		 */
		await databases.create(dbId, dbName);

		/**
		 * Prepare attribtues for Messages
		 */
		await databases.createCollection(
			dbId,
			messageCollectionId,
			messageCollectionName
		);
		await databases.createIntegerAttribute(
			dbId,
			messageCollectionId,
			"maxViews",
			true /* required */,
			0 /* min */,
			undefined /* max */
		);
		await databases.createBooleanAttribute(
			dbId,
			messageCollectionId,
			"nocopy",
			true /* required */
		);
		await databases.createBooleanAttribute(
			dbId,
			messageCollectionId,
			"usePassword",
			true /* required */
		);
		await databases.createIntegerAttribute(
			dbId,
			messageCollectionId,
			"views",
			true /* required */,
			0 /* min */,
			undefined /* max */
		);
		await databases.createStringAttribute(
			dbId,
			messageCollectionId,
			"content",
			1048576 /* 10MB */,
			false /* required */,
			""
		);
		await databases.createDatetimeAttribute(
			dbId,
			messageCollectionId,
			"expiresAt",
			false /* required */
		);

		res.send({
			code: 200,
			message: "Database preparation completed successfully.",
		});
	} catch (error) {
		if (error.type === "database_already_exists") {
			res.send({
				error: "Database has already existed. Please remove the existing database before continuing.",
				type: error.type,
				code: error.code,
			});
		}

		if (error.type === "collection_already_exists") {
			res.send({
				error: "Collection has already existed. Please remove the existing collection before continuing.",
				type: error.type,
				code: error.code,
			});
		}
	}
});

app.get("/__api", (req, res) => {
	res.send({ message: "Success.", code: 200 });
});

app.get("/__api/Messages/:messageId", async (req, res) => {
	const messageId = req.params.messageId;
	const password = req.headers.authorization || "";
	const preflight = !!req.headers.preflight;

	try {
		const doc = await databases.getDocument(
			dbId,
			messageCollectionId,
			messageId
		);

		// Check if views exceeds maxViews
		if (doc.views >= doc.maxViews) {
			// Remove the document from database
			await databases.deleteDocument(
				dbId,
				messageCollectionId,
				messageId
			);
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
			await databases.deleteDocument(
				dbId,
				messageCollectionId,
				messageId
			);
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
			delete doc.content;
			res.status(200).send(doc);
			return;
		}

		if (doc.usePassword) {
			let content = decryptMessage(doc.content, password);
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
		await databases.updateDocument(dbId, messageCollectionId, messageId, {
			views: doc.views + 1,
		});

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
	const messageId = req.body.alias || sdk.ID.unique();
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
		const doc = await databases.createDocument(
			dbId,
			messageCollectionId,
			messageId,
			data
		);

		const createdMessageId =
			typeof messageId === "unique()" ? messageId : doc.$id;

		res.send({
			...data,
			$id: createdMessageId,
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
