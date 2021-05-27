import * as irc from "../lib/irc.js";
import { SERVER_BUFFER, BufferType } from "./state.js";

function getActiveClient(app) {
	var buf = app.state.buffers.get(app.state.activeBuffer);
	if (!buf) {
		return null;
	}
	return app.clients.get(buf.network);
}

export default {
	"buffer": {
		usage: "<name>",
		description: "Switch to a buffer",
		execute: (app, args) => {
			var name = args[0];
			for (var buf of app.state.buffers.values()) {
				if (buf.name === name) {
					app.switchBuffer(buf);
					return;
				}
			}
			throw new Error("Unknown buffer");
		},
	},
	"close": {
		description: "Close the current buffer",
		execute: (app, args) => {
			var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer || activeBuffer.type == BufferType.SERVER) {
				throw new Error("Not in a user or channel buffer");
			}
			app.close(activeBuffer.id);
		},
	},
	"disconnect": {
		description: "Disconnect from the server",
		execute: (app, args) => {
			app.disconnect();
		},
	},
	"help": {
		description: "Show help menu",
		execute: (app, args) => {
			app.openHelp();
		},
	},
	"join": {
		usage: "<name>",
		description: "Join a channel",
		execute: (app, args) => {
			var channel = args[0];
			if (!channel) {
				throw new Error("Missing channel name");
			}
			getActiveClient(app).send({ command: "JOIN", params: [channel] });
		},
	},
	"kick": {
		usage: "<user>",
		description: "Remove a user from the channel",
		execute: (app, args) => {
			var user = args[0];
			var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
				throw new Error("Not in a channel");
			}
			var params = [activeBuffer.name, user];
			if (args.length > 1) {
				params.push(args.slice(1).join(" "));
			}
			getActiveClient(app).send({ command: "KICK", params });
		},
	},
	"me": {
		usage: "<action>",
		description: "Send an action message to the current buffer",
		execute: (app, args) => {
			var action = args.join(" ");
			var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer) {
				throw new Error("Not in a buffer");
			}
			var text = `\x01ACTION ${action}\x01`;
			app.privmsg(activeBuffer.name, text);
		},
	},
	"mode": {
		usage: "<target> <modes> [mode args...]",
		description: "Change channel or user mode",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "MODE", params: args });
		},
	},
	"msg": {
		usage: "<target> <message>",
		description: "Send a message to a nickname or a channel",
		execute: (app, args) => {
			var target = args[0];
			var text = args.slice(1).join(" ");
			getActiveClient(app).send({ command: "PRIVMSG", params: [target, text] });
		},
	},
	"nick": {
		usage: "<nick>",
		description: "Change current nickname",
		execute: (app, args) => {
			var newNick = args[0];
			getActiveClient(app).send({ command: "NICK", params: [newNick] });
		},
	},
	"notice": {
		usage: "<target> <message>",
		description: "Send a notice to a nickname or a channel",
		execute: (app, args) => {
			var target = args[0];
			var text = args.slice(1).join(" ");
			getActiveClient(app).send({ command: "NOTICE", params: [target, text] });
		},
	},
	"part": {
		usage: "[reason]",
		description: "Leave a channel",
		execute: (app, args) => {
			var reason = args.join(" ");
			var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
				throw new Error("Not in a channel");
			}
			var params = [activeBuffer.name];
			if (reason) {
				params.push(reason);
			}
			getActiveClient(app).send({ command: "PART", params });
		},
	},
	"query": {
		usage: "<nick>",
		description: "Open a buffer to send messages to a nickname",
		execute: (app, args) => {
			var nick = args[0];
			if (!nick) {
				throw new Error("Missing nickname");
			}
			app.open(nick);
		},
	},
	"quit": {
		description: "Quit",
		execute: (app, args) => {
			app.close({ name: SERVER_BUFFER });
		},
	},
	"quote": {
		usage: "<command>",
		description: "Send a raw IRC command to the server",
		execute: (app, args) => {
			var msg;
			try {
				msg = irc.parseMessage(args.join(" "));
			} catch (err) {
				throw new Error("Failed to parse IRC command: " + err.message);
			}
			getActiveClient(app).send(msg);
		},
	},
	"reconnect": {
		description: "Reconnect to the server",
		execute: (app, args) => {
			app.reconnect();
		},
	},
	"setname": {
		usage: "<realname>",
		description: "Change current realname",
		execute: (app, args) => {
			var newRealname = args.join(" ");
			var client = getActiveClient(app);
			if (!client.enabledCaps["setname"]) {
				throw new Error("Server doesn't support changing the realname");
			}
			client.send({ command: "SETNAME", params: [newRealname] });
		},
	},
	"topic": {
		usage: "<topic>",
		description: "Change the topic of the current channel",
		execute: (app, args) => {
			var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
				throw new Error("Not in a channel");
			}
			var params = [activeBuffer.name];
			if (args.length > 0) {
				params.push(args.join(" "));
			}
			getActiveClient(app).send({ command: "TOPIC", params });
		},
	},
};
