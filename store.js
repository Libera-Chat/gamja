import { ReceiptType, Unread } from "./state.js";

const PREFIX = "gamja_";

class Item {
	constructor(k) {
		this.k = PREFIX + k;
	}

	load() {
		let v = localStorage.getItem(this.k);
		if (!v) {
			return null;
		}
		return JSON.parse(v);
	}

	put(v) {
		if (v) {
			localStorage.setItem(this.k, JSON.stringify(v));
		} else {
			localStorage.removeItem(this.k);
		}
	}
}

export const autoconnect = new Item("autoconnect");
export const naggedProtocolHandler = new Item("naggedProtocolHandler");
export const settings = new Item("settings");

function debounce(f, delay) {
	let timeout = null;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			timeout = null;
			f(...args);
		}, delay);
	};
}

export class Buffer {
	raw = new Item("buffers");
	m = null;

	constructor() {
		let obj = this.raw.load();
		this.m = new Map(Object.entries(obj || {}));

		let saveImmediately = this.save.bind(this);
		this.save = debounce(saveImmediately, 500);

		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				saveImmediately();
			}
		});
	}

	key(buf) {
		// TODO: use case-mapping here somehow
		return JSON.stringify({
			name: buf.name.toLowerCase(),
			server: {
				bouncerNetwork: buf.server.bouncerNetwork,
			},
		});
	}

	save() {
		if (this.m.size > 0) {
			this.raw.put(Object.fromEntries(this.m));
		} else {
			this.raw.put(null);
		}
	}

	get(buf) {
		return this.m.get(this.key(buf));
	}

	put(buf) {
		let key = this.key(buf);

		let updated = !this.m.has(key);
		let prev = this.m.get(key) || {};

		let unread = prev.unread || Unread.NONE;
		if (buf.unread !== undefined && buf.unread !== prev.unread) {
			unread = buf.unread;
			updated = true;
		}

		let receipts = { ...prev.receipts };
		if (buf.receipts) {
			Object.keys(buf.receipts).forEach((k) => {
				// Use a not-equals comparison here so that no-op receipt
				// changes are correctly handled
				if (!receipts[k] || receipts[k].time < buf.receipts[k].time) {
					receipts[k] = buf.receipts[k];
					updated = true;
				}
			});
			if (receipts[ReceiptType.DELIVERED] < receipts[ReceiptType.READ]) {
				receipts[ReceiptType.DELIVERED] = receipts[ReceiptType.READ];
				updated = true;
			}
		}

		let closed = prev.closed || false;
		if (buf.closed !== undefined && buf.closed !== prev.closed) {
			closed = buf.closed;
			updated = true;
		}

		if (!updated) {
			return false;
		}

		this.m.set(this.key(buf), {
			name: buf.name,
			unread,
			receipts,
			closed,
			server: {
				bouncerNetwork: buf.server.bouncerNetwork,
			},
		});

		this.save();
		return true;
	}

	delete(buf) {
		this.m.delete(this.key(buf));
		this.save();
	}

	list(server) {
		// Some gamja versions would store the same buffer multiple times
		let names = new Set();
		let buffers = [];
		for (const buf of this.m.values()) {
			if (buf.server.bouncerNetwork !== server.bouncerNetwork) {
				continue;
			}
			if (names.has(buf.name)) {
				continue;
			}
			buffers.push(buf);
			names.add(buf.name);
		}
		return buffers;
	}

	clear(server) {
		if (server) {
			for (const buf of this.list(server)) {
				this.m.delete(this.key(buf));
			}
		} else {
			this.m = new Map();
		}
		this.save();
	}
}
