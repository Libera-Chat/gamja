import { SERVER_BUFFER } from "/state.js";

function getActiveClient(app) {
	var buf = app.state.buffers.get(app.state.activeBuffer);
	if (!buf) {
		return null;
	}
	return app.clients.get(buf.network);
}

export default {
	"query": (app, args) => {
		var nick = args[0];
		if (!nick) {
			throw new Error("Missing nickname");
		}
		app.open(nick);
	},
	"quit": (app, args) => {
		if (window.localStorage) {
			localStorage.removeItem("autoconnect");
		}
		app.close(SERVER_BUFFER);
	},
	"query": (app, args) => {
		var nick = args[0];
		if (!nick) {
			throw new Error("Missing nickname");
		}
		app.open(nick);
	},
	"close": (app, args) => {
		var target = app.state.activeBuffer;
		if (!target || target == SERVER_BUFFER) {
			throw new Error("Not in a user or channel buffer");
		}
		app.close(target);
	},
	"join": (app, args) => {
		var channel = args[0];
		if (!channel) {
			throw new Error("Missing channel name");
		}
		getActiveClient(app).send({ command: "JOIN", params: [channel] });
	},
	"part": (app, args) => {
		var reason = args.join(" ");
		var channel = app.state.activeBuffer;
		if (!channel || !app.isChannel(channel)) {
			throw new Error("Not in a channel");
		}
		var params = [channel];
		if (reason) {
			params.push(reason);
		}
		getActiveClient(app).send({ command: "PART", params });
	},
	"msg": (app, args) => {
		var target = args[0];
		var text = args.slice(1).join(" ");
		getActiveClient(app).send({ command: "PRIVMSG", params: [target, text] });
	},
	"me": (app, args) => {
		var action = args.join(" ");
		var target = app.state.activeBuffer;
		if (!target) {
			throw new Error("Not in a buffer");
		}
		var text = `\x01ACTION ${action}\x01`;
		app.privmsg(target, text);
	},
	"nick": (app, args) => {
		var newNick = args[0];
		getActiveClient(app).send({ command: "NICK", params: [newNick] });
	},
	"notice": (app, args) => {
		var target = args[0];
		var text = args.slice(1).join(" ");
		getActiveClient(app).send({ command: "NOTICE", params: [target, text] });
	},
	"buffer": (app, args) => {
		var name = args[0];
		for (var buf of app.state.buffers.values()) {
			if (buf.name === name) {
				app.switchBuffer(buf);
				return;
			}
		}
		throw new Error("Unknown buffer");
	},
	"topic": (app, args) => {
		var channel = app.state.activeBuffer;
		if (!channel || !app.isChannel(channel)) {
			throw new Error("Not in a channel");
		}
		var params = [channel];
		if (args.length > 0) {
			params.push(args.join(" "));
		}
		getActiveClient(app).send({ command: "TOPIC", params });
	},
	"reconnect": (app, args) => {
		app.reconnect();
	},
	"disconnect": (app, args) => {
		app.disconnect();
	},
};
