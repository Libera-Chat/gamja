import * as irc from "./lib/irc.js";
import Client from "./lib/client.js";

export const SERVER_BUFFER = "*";

export const BufferType = {
	SERVER: "server",
	CHANNEL: "channel",
	NICK: "nick",
};

export const ServerStatus = Client.Status;

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

export function getServerName(server, bouncerNetwork, isBouncer) {
	if (bouncerNetwork && bouncerNetwork.name) {
		return bouncerNetwork.name;
	}
	if (isBouncer) {
		return "bouncer";
	}

	var netName = server.isupport.get("NETWORK");
	if (netName) {
		return netName;
	}

	return "server";
}

function updateState(state, updater) {
	var updated;
	if (typeof updater === "function") {
		updated = updater(state, state);
	} else {
		updated = updater;
	}
	if (state === updated || !updated) {
		return;
	}
	return { ...state, ...updated };
}

export const State = {
	updateServer(state, id, updater) {
		var server = state.servers.get(id);
		if (!server) {
			return;
		}

		var updated = updateState(server, updater);
		if (!updated) {
			return;
		}

		var servers = new Map(state.servers);
		servers.set(id, updated);
		return { servers };
	},
	updateBuffer(state, id, updater) {
		var buf = State.getBuffer(state, id);
		if (!buf) {
			return;
		}

		var updated = updateState(buf, updater);
		if (!updated) {
			return;
		}

		var buffers = new Map(state.buffers);
		buffers.set(buf.id, updated);
		return { buffers };
	},
	getActiveServerID(state) {
		var buf = state.buffers.get(state.activeBuffer);
		if (!buf) {
			return null;
		}
		return buf.server;
	},
	getBuffer(state, id) {
		switch (typeof id) {
		case "number":
			return state.buffers.get(id);
		case "object":
			if (id.id) {
				return state.buffers.get(id.id);
			}

			var serverID = id.server, name = id.name;
			if (!serverID) {
				serverID = State.getActiveServerID(state);
			}

			var cm = irc.CaseMapping.RFC1459;
			var server = state.servers.get(serverID);
			if (server) {
				cm = irc.CaseMapping.byName(server.isupport.get("CASEMAPPING")) || cm;
			}

			var nameCM = cm(name);
			for (var buf of state.buffers.values()) {
				if (buf.server === serverID && cm(buf.name) === nameCM) {
					return buf;
				}
			}
			return null;
		default:
			throw new Error("Invalid buffer ID type: " + (typeof id));
		}
	},
};
