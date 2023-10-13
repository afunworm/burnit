import { Injectable } from '@angular/core';
import { Message, MessageContent } from '../interfaces/message.interface';
import { DocumentSnapshot, doc, getDoc, getFirestore, increment, setDoc, updateDoc } from 'firebase/firestore';
import * as CryptoJS from 'crypto-js';
import { encryptionSalt, messageRefSalt } from '../core/config/app.config';

@Injectable({
    providedIn: 'root',
})
export class MessageService {

    private _docSnap: DocumentSnapshot;

    generateFirestoreId(length: number = 8): string {
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

    addMessage(data: Message): Promise<string> {

        if (!data) return Promise.reject();
        let docId = '';
        let content = data.content;

        if (data.alias) docId = data.alias;
        else docId = this.generateFirestoreId();

        // Get MessageContent Ref
        data.ref = this.generateFirestoreId(32);
        let messageContentRef = this.encryptMessageContentRef(data.ref);

        delete data.alias;
        delete data.content;

        const firestore = getFirestore();
        const messageDoc = doc(firestore, 'Messages', docId);
        const messageContentDoc = doc(firestore, 'MessageContent', messageContentRef);

        return new Promise(async (resolve, reject) => {

            try {
                await setDoc(messageContentDoc, { content });
                await setDoc(messageDoc, data);

                resolve(docId);
            } catch (error) {
                reject(error);
            }

        });

    }

    messageExists(messageId: string): Promise<boolean> {
        
        return new Promise(async (resolve, reject) => {

            const firestore = getFirestore();
            const docRef = doc(firestore, 'Messages', messageId);

            try {
                const docSnap = await getDoc(docRef);
                resolve(docSnap.exists());
            } catch (error) {
                reject(error);
            }
            
        });

    }

    getMessageSnapshot(messageId: string): Promise<DocumentSnapshot> {
        return new Promise(async (resolve, reject) => {

            const firestore = getFirestore();
            const docRef = doc(firestore, 'Messages', messageId);

            try {
                const docSnap = await getDoc(docRef);
                this._docSnap = docSnap;

                resolve(docSnap);
            } catch (error) {
                reject(error);
            }

        });
    }

    increaseMessageView(): Promise<void> {
        if (!this._docSnap) return Promise.reject();

        return new Promise(async (resolve, reject) => {

            const firestore = getFirestore();
            const messageId = this._docSnap.id;
            const docRef = doc(firestore, 'Messages', messageId);

            // Increment view count
            try {
                await updateDoc(docRef, { views: increment(1) });
                resolve();
            } catch (error) {
                reject(error);
            }

        });
    }

    getMessageData(): Promise<Message> {
        if (!this._docSnap) return Promise.reject();

        return new Promise(async (resolve, reject) => {

            const firestore = getFirestore();
            const messageId = this._docSnap.id;
            const docRef = doc(firestore, 'Messages', messageId);

            let data = this._docSnap.data() as Message;
            resolve(data);

        });

    }

    getMessageContent(messageId: string): Promise<string> {
        return new Promise(async (resolve, reject) => {

            const firestore = getFirestore();
            const docRef = doc(firestore, 'MessageContent', messageId);

            try {
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    const data = docSnap.data() as MessageContent;
                    resolve(data.content);
                }

                reject('Unable to find the message in the databsae.');
            } catch (error) {
                reject(error);
            }

        });
    }

    encryptMessage(message: string, passphrase: string): string {
        if (!message) message = "";

        const encryptionKey = passphrase + encryptionSalt;
        return CryptoJS.AES.encrypt(message, encryptionKey).toString();
    }

    decryptMessage(input: string, passphrase: string): Promise<string> {
        const encryptionKey = passphrase + encryptionSalt;

        return new Promise((resolve, reject) => {

            try {
                let decryptedMessage = CryptoJS.AES.decrypt(input, encryptionKey).toString(CryptoJS.enc.Utf8);

                if (decryptedMessage === '') return reject('INVALID_PASSWORD');

                resolve(decryptedMessage);
            } catch (error) {
                reject(error);
            }
        });
    }

    encryptMessageContentRef(DocumentId: string): string {
        return CryptoJS.MD5(DocumentId + messageRefSalt).toString();
    }
}