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

const rawReceipts = new Item("receipts");

export const receipts = {
	load() {
		let v = rawReceipts.load();
		return new Map(Object.entries(v || {}));
	},
	put(m) {
		rawReceipts.put(Object.fromEntries(m));
	},
};

export class Buffer {
	raw = new Item("buffers");
	m = null;

	constructor() {
		let obj = this.raw.load();
		this.m = new Map(Object.entries(obj || {}));
	}

	key(buf) {
		return JSON.stringify({
			name: buf.name,
			server: {
				url: buf.server.url,
				nick: buf.server.nick,
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

		let prev = this.m.get(key);
		if (prev && prev.unread === buf.unread) {
			return;
		}

		this.m.set(this.key(buf), {
			name: buf.name,
			unread: buf.unread,
			server: {
				url: buf.server.url,
				nick: buf.server.nick,
				bouncerNetwork: buf.server.bouncerNetwork,
			},
		});

		this.save();
	}

	delete(buf) {
		this.m.delete(this.key(buf));
		this.save();
	}

	list(server) {
		let buffers = [];
		for (const buf of this.m.values()) {
			if (buf.server.url !== server.url || buf.server.nick !== server.nick || buf.server.bouncerNetwork !== server.bouncerNetwork) {
				continue;
			}
			buffers.push(buf);
		}
		return buffers;
	}

	clear(server) {
		if (server) {
			for (const buf of this.m.values()) {
				this.m.delete(this.key(buf));
			}
		} else {
			this.m = new Map();
		}
		this.save();
	}
}
