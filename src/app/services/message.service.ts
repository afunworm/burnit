import { Injectable, inject } from "@angular/core";
import { Message } from "../interfaces/message.interface";
import { HttpClient, HttpHeaders } from "@angular/common/http";

@Injectable({
	providedIn: "root",
})
export class MessageService {
	private _apiURL: string = "/__api";
	private _http = inject(HttpClient);

	addMessage(data: Message) {
		let docId = "";

		if (data.alias) docId = data.alias;

		let apiURL = `${this._apiURL}/Messages/`;

		return this._http.post<any>(apiURL, data);
	}

	getMessageSnapshot(messageId: string) {
		let apiURL = `${this._apiURL}/Messages/${messageId}`;
		let headers = new HttpHeaders({ Preflight: 1 });

		return this._http.get<any>(apiURL, { headers });
	}

	getMessageContent(messageId: string, password: string = "") {
		let apiURL = `${this._apiURL}/Messages/${messageId}`;
		let headers = new HttpHeaders({ Authorization: password });

		return this._http.get<any>(apiURL, { headers });
	}
}
