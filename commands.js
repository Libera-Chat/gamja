import * as irc from "./lib/irc.js";
import { SERVER_BUFFER, BufferType, Unread } from "./state.js";

function getActiveClient(app) {
	let buf = app.state.buffers.get(app.state.activeBuffer);
	if (!buf) {
		throw new Error("Not connected to server");
	}
	return app.clients.get(buf.server);
}

function getActiveTarget(app) {
	let activeBuffer = app.state.buffers.get(app.state.activeBuffer);
	if (!activeBuffer) {
		throw new Error("Not in a buffer");
	}
	return activeBuffer.name;
}

function getActiveChannel(app) {
	let activeBuffer = app.state.buffers.get(app.state.activeBuffer);
	if (!activeBuffer || activeBuffer.type !== BufferType.CHANNEL) {
		throw new Error("Not in a channel");
	}
	return activeBuffer.name;
}

async function setUserHostMode(app, args, mode) {
	let nick = args[0];
	if (!nick) {
		throw new Error("Missing nick");
	}
	let activeChannel = getActiveChannel(app);
	let client = getActiveClient(app);
	let whois = await client.whois(nick);
	const info = whois[irc.RPL_WHOISUSER].params;
	const user = info[2];
	const host = info[3];
	client.send({
		command: "MODE",
		params: [activeChannel, mode, `*!${user}@${host}`],
	});
}

function markServerBufferUnread(app) {
	let activeBuffer = app.state.buffers.get(app.state.activeBuffer);
	if (!activeBuffer || activeBuffer.type === BufferType.SERVER) {
		return;
	}
	app.setBufferState({ server: activeBuffer.server }, (buf) => {
		return { unread: Unread.union(buf.unread, Unread.MESSAGE) };
	});
}

const join = {
	usage: "<name> [password]",
	description: "Join a channel",
	execute: (app, args) => {
		let channel = args[0];
		if (!channel) {
			throw new Error("Missing channel name");
		}
		if (args.length > 1) {
			app.open(channel, null, args[1]);
		} else {
			app.open(channel);
		}
	},
};

const kick = {
	usage: "<nick> [comment]",
	description: "Remove a user from the channel",
	execute: (app, args) => {
		let nick = args[0];
		let activeChannel = getActiveChannel(app);
		let params = [activeChannel, nick];
		if (args.length > 1) {
			params.push(args.slice(1).join(" "));
		}
		getActiveClient(app).send({ command: "KICK", params });
	},
};

const ban = {
	usage: "[nick]",
	description: "Ban a user from the channel, or display the current ban list",
	execute: (app, args) => {
		if (args.length == 0) {
			let activeChannel = getActiveChannel(app);
			getActiveClient(app).send({
				command: "MODE",
				params: [activeChannel, "+b"],
			});
		} else {
			return setUserHostMode(app, args, "+b");
		}
	},
};

function givemode(app, args, mode) {
	// TODO: Handle several users at once
	let nick = args[0];
	if (!nick) {
		throw new Error("Missing nick");
	}
	let activeChannel = getActiveChannel(app);
	getActiveClient(app).send({
		command: "MODE",
		params: [activeChannel, mode, nick],
	});
}

export default {
	"away": {
		usage: "[message]",
		description: "Set away message",
		execute: (app, args) => {
			const params = []
			if (args.length) {
				params.push(args.join(" "));
			}
			getActiveClient(app).send({command: "AWAY", params});
		},
	},
	"ban": ban,
	"buffer": {
		usage: "<name>",
		description: "Switch to a buffer",
		execute: (app, args) => {
			let name = args[0];
			for (let buf of app.state.buffers.values()) {
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
			let activeBuffer = app.state.buffers.get(app.state.activeBuffer);
			if (!activeBuffer || activeBuffer.type == BufferType.SERVER) {
				throw new Error("Not in a user or channel buffer");
			}
			app.close(activeBuffer.id);
		},
	},
	"deop": {
		usage: "<nick>",
		description: "Remove operator status for a user on this channel",
		execute: (app, args) => givemode(app, args, "-o"),
	},
	"devoice": {
		usage: "<nick>",
		description: "Remove voiced status for a user on this channel",
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
		description: "Invite a user to the channel",
		execute: (app, args) => {
			let nick = args[0];
			if (!nick) {
				throw new Error("Missing nick");
			}
			let activeChannel = getActiveChannel(app);
			getActiveClient(app).send({ command: "INVITE", params: [
				nick, activeChannel,
			]});
		},
	},
	"j": join,
	"join": join,
	"kick": kick,
	"kickban": {
		usage: "<target>",
		description: "Ban a user and removes them from the channel",
		execute: (app, args) => {
			kick.execute(app, args);
			ban.execute(app, args);
		},
	},
	"lusers": {
		usage: "[<mask> [<target>]]",
		description: "Request user statistics about the network",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "LUSERS", params: args });
			markServerBufferUnread(app);
		},
	},
	"me": {
		usage: "<action>",
		description: "Send an action message to the current buffer",
		execute: (app, args) => {
			let action = args.join(" ");
			let target = getActiveTarget(app);
			let text = `\x01ACTION ${action}\x01`;
			app.privmsg(target, text);
		},
	},
	"mode": {
		usage: "[target] [modes] [mode args...]",
		description: "Query or change a channel or user mode",
		execute: (app, args) => {
			let target = args[0];
			if (!target || target.startsWith("+") || target.startsWith("-")) {
				let activeChannel = getActiveChannel(app);
				args = [activeChannel, ...args];
			}
			getActiveClient(app).send({ command: "MODE", params: args });
		},
	},
	"motd": {
		usage: "[server]",
		description: "Get the Message Of The Day",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "MOTD", params: args });
			markServerBufferUnread(app);
		},
	},
	"msg": {
		usage: "<target> <message>",
		description: "Send a message to a nickname or a channel",
		execute: (app, args) => {
			let target = args[0];
			let text = args.slice(1).join(" ");
			getActiveClient(app).send({ command: "PRIVMSG", params: [target, text] });
		},
	},
	"nick": {
		usage: "<nick>",
		description: "Change current nickname",
		execute: (app, args) => {
			let newNick = args[0];
			getActiveClient(app).send({ command: "NICK", params: [newNick] });
		},
	},
	"notice": {
		usage: "<target> <message>",
		description: "Send a notice to a nickname or a channel",
		execute: (app, args) => {
			let target = args[0];
			let text = args.slice(1).join(" ");
			getActiveClient(app).send({ command: "NOTICE", params: [target, text] });
		},
	},
	"op": {
		usage: "<nick>",
		description: "Give a user operator status on this channel",
		execute: (app, args) => givemode(app, args, "+o"),
	},
	"part": {
		usage: "[reason]",
		description: "Leave a channel",
		execute: (app, args) => {
			let reason = args.join(" ");
			let activeChannel = getActiveChannel(app);
			let params = [activeChannel];
			if (reason) {
				params.push(reason);
			}
			getActiveClient(app).send({ command: "PART", params });
		},
	},
	"query": {
		usage: "<nick> [message]",
		description: "Open a buffer to send messages to a nickname",
		execute: (app, args) => {
			let nick = args[0];
			if (!nick) {
				throw new Error("Missing nickname");
			}
			app.open(nick);

			if (args.length > 1) {
				let text = args.slice(1).join(" ");
				app.privmsg(nick, text);
			}
		},
	},
	"quiet": {
		usage: "[nick]",
		description: "Quiet a user in the channel, or display the current quiet list",
		execute: (app, args) => {
			if (args.length == 0) {
				getActiveClient(app).send({
					command: "MODE",
					params: [getActiveChannel(app), "+q"],
				});
			} else {
				return setUserHostMode(app, args, "+q");
			}
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
			let msg;
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
			let newRealname = args.join(" ");
			let client = getActiveClient(app);
			if (!client.caps.enabled.has("setname")) {
				throw new Error("Server doesn't support changing the realname");
			}
			client.send({ command: "SETNAME", params: [newRealname] });
			// TODO: save to local storage
		},
	},
	"stats": {
		usage: "<query> [server]",
		description: "Request server statistics",
		execute: (app, args) => {
			let query = args[0];
			if (!query) {
				throw new Error("Missing query");
			}
			let params = [query];
			if (args.length > 1) {
				params.push(args.slice(1).join(" "));
			}
			getActiveClient(app).send({ command: "STATS", params });
			markServerBufferUnread(app);
		},
	},
	"topic": {
		usage: "<topic>",
		description: "Change the topic of the current channel",
		execute: (app, args) => {
			let activeChannel = getActiveChannel(app);
			let params = [activeChannel];
			if (args.length > 0) {
				params.push(args.join(" "));
			}
			getActiveClient(app).send({ command: "TOPIC", params });
		},
	},
	"unban": {
		usage: "<nick>",
		description: "Remove a user from the ban list",
		execute: (app, args) => {
			return setUserHostMode(app, args, "-b");
		},
	},
	"unquiet": {
		usage: "<nick>",
		description: "Remove a user from the quiet list",
		execute: (app, args) => {
			return setUserHostMode(app, args, "-q");
		},
	},
	"unvoice": {
		usage: "<nick>",
		description: "Remove a user from the voiced list",
		execute: (app, args) => givemode(app, args, "-v"),
	},
	"voice": {
		usage: "<nick>",
		description: "Give a user voiced status on this channel",
		execute: (app, args) => givemode(app, args, "+v"),
	},
	"who": {
		usage: "<mask>",
		description: "Retrieve a list of users",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "WHO", params: args });
			markServerBufferUnread(app);
		},
	},
	"whois": {
		usage: "<nick>",
		description: "Retrieve information about a user",
		execute: (app, args) => {
			let nick = args[0];
			if (!nick) {
				throw new Error("Missing nick");
			}
			getActiveClient(app).send({ command: "WHOIS", params: [nick] });
			markServerBufferUnread(app);
		},
	},
	"whowas": {
		usage: "<nick> [count]",
		description: "Retrieve information about an offline user",
		execute: (app, args) => {
			if (args.length < 1) {
				throw new Error("Missing nick");
			}
			getActiveClient(app).send({ command: "WHOWAS", params: args });
			markServerBufferUnread(app);
		},
	},
	"list": {
		usage: "[filter]",
		description: "Retrieve a list of channels from a network",
		execute: (app, args) => {
			getActiveClient(app).send({ command: "LIST", params: args });
			markServerBufferUnread(app);
		},
	},
};
