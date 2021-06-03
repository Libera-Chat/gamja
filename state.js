import Client from "./lib/client.js";

export const SERVER_BUFFER = "*";

export const BufferType = {
	SERVER: "server",
	CHANNEL: "channel",
	NICK: "nick",
};

export const NetworkStatus = Client.Status;

export const Unread = {
	NONE: "",
	MESSAGE: "message",
	HIGHLIGHT: "highlight",

	compare(a, b) {
		const priority = {
			[Unread.NONE]: 0,
			[Unread.MESSAGE]: 1,
			[Unread.HIGHLIGHT]: 2,
		};
		return priority[a] - priority[b];
	},
	union(a, b) {
		return (Unread.compare(a, b) > 0) ? a : b;
	},
};

export const ReceiptType = {
	DELIVERED: "delivered",
	READ: "read",
};

export function getNickURL(nick) {
	return "irc:///" + encodeURIComponent(nick) + ",isuser";
}

export function getChannelURL(channel) {
	return "irc:///" + encodeURIComponent(channel);
}

export function getBufferURL(buf) {
	switch (buf.type) {
	case BufferType.SERVER:
		return "irc:///";
	case BufferType.CHANNEL:
		return getChannelURL(buf.name);
	case BufferType.NICK:
		return getNickURL(buf.name);
	}
	throw new Error("Unknown buffer type: " + buf.type);
}

export function getMessageURL(buf, msg) {
	var bufURL = getBufferURL(buf);
	if (msg.tags.msgid) {
		return bufURL + "?msgid=" + encodeURIComponent(msg.tags.msgid);
	} else {
		return bufURL + "?timestamp=" + encodeURIComponent(msg.tags.time);
	}
}

export function getNetworkName(network, bouncerNetwork, isBouncer) {
	if (bouncerNetwork && bouncerNetwork.name) {
		return bouncerNetwork.name;
	}
	if (isBouncer) {
		return "bouncer";
	}

	var netName = network.isupport.get("NETWORK");
	if (netName) {
		return netName;
	}

	return "server";
}
