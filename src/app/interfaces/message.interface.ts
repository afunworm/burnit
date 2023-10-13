import { Dayjs } from "dayjs";
import { DocumentReference, Timestamp } from "firebase/firestore";

export interface Message {
    content?: string;
    createdAt: Timestamp | Date | Dayjs;
    expiresAt: Timestamp | Date | Dayjs;
    maxViews: number;
    usePassword: boolean;
    views: number;
    alias?: string;
    nocopy: boolean;
    ref: string;
}

export interface MessageContent {
    content: string;
}