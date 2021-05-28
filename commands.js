import * as irc from "./lib/irc.js";
import { SERVER_BUFFER, BufferType } from "./state.js";

function getActiveClient(app) {
	var buf = app.state.buffers.get(app.state.activeBuffer);
	if (!buf) {
		return null;
	}
	return app.clients.get(buf.network);
}

const ban = {
	usage: "<nick>",
	description: "Bans a user from the channel",
	execute: (app, args) => {
		var nick = args[0];
		if (!nick) {
			throw new Error("Missing nick");
		}
		var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
		if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
			throw new Error("Not in a channel");
		}
		var params = [activeBuffer.name, nick];
		if (args.length > 1) {
			params.push(args.slice(1).join(" "));
		}
		const client = getActiveClient(app);
		client.whois(nick).then((whois) => {
			if (whois === null) {
				throw new Error("No such nick");
			};
			const info = whois[irc.RPL_WHOISUSER].params;
			const user = info[2];
			const host = info[3];
			client.send({ command: "MODE", params: [
				activeBuffer.name,
				"+b",
				`*!${user}@${host}`
			]});
		});
	},
};

const join = {
	usage: "<name>",
	description: "Join a channel",
	execute: (app, args) => {
		var channel = args[0];
		if (!channel) {
			throw new Error("Missing channel name");
		}
		app.open(channel);
	},
};

const kick = {
	usage: "<nick>",
	description: "Remove a user from the channel",
	execute: (app, args) => {
		var nick = args[0];
		var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
		if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
			throw new Error("Not in a channel");
		}
		var params = [activeBuffer.name, nick];
		if (args.length > 1) {
			params.push(args.slice(1).join(" "));
		}
		getActiveClient(app).send({ command: "KICK", params });
	},
};

function givemode(app, args, mode) {
	// TODO: Handle several users at once
	var nick = args[0];
	if (!nick) {
		throw new Error("Missing nick");
	}
	var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
	if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
		throw new Error("Not in a channel");
	}
	getActiveClient(app).send({ command: "MODE", params: [
		activeBuffer.name, mode, nick,
	]});
}

export default {
	"ban": ban,
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
	"deop": {
		usage: "<nick>",
		description: "Removes operator status for a user on this channel",
		execute: (app, args) => givemode(app, args, "-o"),
	},
	"devoice": {
		usage: "<nick>",
		description: "Removes voiced status for a user on this channel",
		execute: (app, args) => givemode(app, args, "-v"),
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
	"invite": {
		usage: "<nick>",
		description: "Invites a user to the channel",
		execute: (app, args) => {
			var nick = args[0];
			if (!nick) {
				throw new Error("Missing nick");
			}
			var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
				throw new Error("Not in a channel");
			}
			getActiveClient(app).send({ command: "INVITE", params: [
				nick, activeBuffer.name,
			]});
		},
	},
	"j": join,
	"join": join,
	"kick": kick,
	"kickban": {
		usage: "<target>",
		description: "Bans a user and removes them from the channel",
		execute: (app, args) => {
			kick.execute(app, args);
			ban.execute(app, args);
		},
	},
	"lusers": {
		usage: "[<mask> [<target>]]",
		description: "Requests user statistics about the network",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "LUSERS", params: args });
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
		usage: "[target] <modes> [mode args...]",
		description: "Change channel or user mode",
		execute: (app, args) => {
			var target = args[0];
			if (target.startsWith("+") || target.startsWith("-")) {
				var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
				if (!activeBuffer || !app.isChannel(activeBuffer.name)) {
					throw new Error("Not in a channel");
				}
				args = [activeBuffer.name, ...args];
			}
			getActiveClient(app).send({ command: "MODE", params: args });
		},
	},
	"motd": {
		usage: "[server]",
		description: "Get the Message Of The Day",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "MOTD", params: args });
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
	"op": {
		usage: "<nick>",
		description: "Gives a user operator status on this channel",
		execute: (app, args) => givemode(app, args, "+o"),
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
	"stats": {
		usage: "<query> [server]",
		description: "Requests server statistics",
		execute: (app, args) => {
			var query = args[0];
			if (!query) {
				throw new Error("Missing query");
			}
			var params = [query];
			if (args.length > 1) {
				params.push(args.slice(1).join(" "));
			}
			getActiveClient(app).send({ command: "STATS", params });
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
	"voice": {
		usage: "<nick>",
		description: "Gives a user voiced status on this channel",
		execute: (app, args) => givemode(app, args, "+v"),
	},
	"whois": {
		usage: "<nick>",
		description: "Retrieve information about a user",
		execute: (app, args) => {
			var nick = args[0];
			if (!nick) {
				throw new Error("Missing nick");
			}
			getActiveClient(app).whois(nick);
		},
	},
};
