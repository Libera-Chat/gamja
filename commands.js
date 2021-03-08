import { SERVER_BUFFER, BufferType } from "./state.js";

function getActiveClient(app) {
	var buf = app.state.buffers.get(app.state.activeBuffer);
	if (!buf) {
		return null;
	}
	return app.clients.get(buf.network);
}

export default {
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
	"close": (app, args) => {
		var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
		if (!activeBuffer || activeBuffer.type == BufferType.SERVER) {
			throw new Error("Not in a user or channel buffer");
		}
		app.close(activeBuffer.id);
	},
	"disconnect": (app, args) => {
		app.disconnect();
	},
	"help": (app, args) => {
		app.openHelp();
	},
	"join": (app, args) => {
		var channel = args[0];
		if (!channel) {
			throw new Error("Missing channel name");
		}
		getActiveClient(app).send({ command: "JOIN", params: [channel] });
	},
	"me": (app, args) => {
		var action = args.join(" ");
		var activeBuffer = app.state.buffers.get(app.state.activeBuffer);
		if (!activeBuffer) {
			throw new Error("Not in a buffer");
		}
		var text = `\x01ACTION ${action}\x01`;
		app.privmsg(activeBuffer.name, text);
	},
	"msg": (app, args) => {
		var target = args[0];
		var text = args.slice(1).join(" ");
		getActiveClient(app).send({ command: "PRIVMSG", params: [target, text] });
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
	"part": (app, args) => {
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
		app.close({ name: SERVER_BUFFER });
	},
	"reconnect": (app, args) => {
		app.reconnect();
	},
	"topic": (app, args) => {
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
};
