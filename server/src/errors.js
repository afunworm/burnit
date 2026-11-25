export class ApiError extends Error {
	constructor(status, type, message, extra = {}) {
		super(message);
		this.status = status;
		this.type = type;
		this.extra = extra;
	}
}
