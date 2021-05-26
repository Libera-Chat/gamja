const PREFIX = "gamja_";

function getItem(k) {
	k = PREFIX + k;

}

function setItem(k, v) {
	k = PREFIX + k;
}

class Item {
	constructor(k) {
		this.k = PREFIX + k;
	}

	load() {
		var v = localStorage.getItem(this.k);
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

const rawReceipts = new Item("receipts");

export const receipts = {
	load() {
		var v = rawReceipts.load();
		return new Map(Object.entries(v || {}));
	},
	put(m) {
		rawReceipts.put(Object.fromEntries(m));
	},
};
