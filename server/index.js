// Router
const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ApPWrite
const sdk = require('node-appwrite');
const client = new sdk.Client();
const databases = new sdk.Databases(client);
client
    .setEndpoint('https://appwrite.byh.uy/v1')
    .setProject('653046721a19ec88109e')
    .setKey('60ab6f61d5f34cd6158b775681381f69223318556fe00a5f88274fc2f3a57a686ed93a105c369d2d87becd8e35a2bef7a7c4178d7e59ced2f680df54e028c45c3a02186ffc3d5936aa2030fd8743f9561b34a0bab70657112387309ef75d39e4d5585d5b76a3b78b2d75ecea00c8ad69253a9276d3030b9e707c66eff70851c1')
;

// Crypto JS
const CryptoJS = require('crypto-js');

// Misc configuration
const dbId = 'main';
const dbName = 'Main';
const messageCollectionId = 'messages';
const messageCollectionName = 'Messages';
// const contentCollectionId = 'content';
// const contentCollectionName = 'Content';
const encryptionSalt = "NlBK7TgXLpQZ7JbnKSy2nxafGEkyhBpHCmzWGJNz";
const messageRefSalt = "MucFzlqcTd";

const port = 8888;

// Misc function
encryptMessage = (message, passphrase) => {
    if (!message) message = "";

    const encryptionKey = passphrase + encryptionSalt;
    return CryptoJS.AES.encrypt(message, encryptionKey).toString();
}

decryptMessage = (input, passphrase) => {
    const encryptionKey = passphrase + encryptionSalt;

    return new Promise((resolve, reject) => {

        try {
            let decryptedMessage = CryptoJS.AES.decrypt(input, encryptionKey).toString(CryptoJS.enc.Utf8);

            if (decryptedMessage === '') return reject('INVALId_PASSWORD');

            resolve(decryptedMessage);
        } catch (error) {
            reject(error);
        }
    });
}

encryptMessageContentRef = (DocumentId) => {
    return CryptoJS.MD5(DocumentId + messageRefSalt).toString();
}

generateId = (length = 8) => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result; 
}

/**
 * Main Route
 */
app.get('/install', async (req, res) => {
    try {

        /**
         * Prepare the database
         */
        await databases.create(dbId, dbName);

        /**
         * Prepare attribtues for Messages
         */
        await databases.createCollection(dbId, messageCollectionId, messageCollectionName);
        await databases.createIntegerAttribute(dbId, messageCollectionId, 'maxViews', true /* required */, 0 /* min */, undefined /* max */);
        await databases.createBooleanAttribute(dbId, messageCollectionId, 'nocopy', true /* required */);
        // await databases.createStringAttribute(dbId, messageCollectionId, 'ref', 32, true /* required */);
        await databases.createBooleanAttribute(dbId, messageCollectionId, 'usePassword', true /* required */);
        await databases.createIntegerAttribute(dbId, messageCollectionId, 'views', true /* required */, 0 /* min */, undefined /* max */);
        await databases.createStringAttribute(dbId, messageCollectionId, 'content', 1048576 /* 10MB */, false /* required */, '');
        await databases.createDatetimeAttribute(dbId, messageCollectionId, 'expiresAt', false /* required */);

        /**
         * Prepare attribtues for Content
         */
        // await databases.createCollection(dbId, contentCollectionId, contentCollectionName);
        // await databases.createStringAttribute(dbName, contentCollectionId, 'content', 1048576 /* 10MB */, false /* required */, '');

        res.send({ code: 200, message: 'Database preparation completed successfully.' });

    } catch (error) {
        
        if (error.type === 'database_already_exists') {
            res.send({ error: 'Database has already existed.', type: error.type, code: error.code });
        }

        if (error.type === 'collection_already_exists') {
            res.send({ error: 'Collection has already existed.', type: error.type, code: error.code });
        }

    }

});

app.get('/', (req, res) => {

    res.send({ message: 'Success.', code: 200 });

});

app.post('/Messages', async (req, res) => {

    let data = req.body.data;
    const messageId = req.body.alias || sdk.ID.unique();
    let password = data.password;
    data.content = !!data.usePassword && !!data.password ? encryptMessage(data.content, password) : data.content; // Transform content if password is used

    // Transform ref to get path for Message Content
    // data.ref = encryptMessageContentRef(messageId);

    // Remove password if existe
    delete data.password;

    try {
        const doc = await databases.createDocument(dbId, messageCollectionId, messageId, data);

        res.send({ code: 200, message: `New message ${ typeof messageId === 'unique()' ? messageId : doc.$id } added successfully.` });
    } catch (error) {

        if (error.type === 'document_already_exists') {
            res.send({ error: 'Document has already existed.', type: error.type, code: error.code });
        }
        
        res.send(error);

    }

});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});