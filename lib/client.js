import * as irc from "./irc.js";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = [
	"away-notify",
	"batch",
	"draft/chathistory",
	"echo-message",
	"message-tags",
	"multi-prefix",
	"server-time",
];

export default class Client extends EventTarget {
	static Status = {
		DISCONNECTED: "disconnected",
		CONNECTING: "connecting",
		REGISTERING: "registering",
		REGISTERED: "registered",
	};

	status = Client.Status.DISCONNECTED;
	ws = null;
	nick = null;
	params = {
		url: null,
		username: null,
		realname: null,
		nick: null,
		pass: null,
		saslPlain: null,
	};
	availableCaps = {};
	enabledCaps = {};
	batches = new Map();

	constructor(params) {
		super();

		this.params = Object.assign(this.params, params);

		this.reconnect();
	}

	reconnect() {
		this.disconnect();
		this.setStatus(Client.Status.CONNECTING);

		try {
			this.ws = new WebSocket(this.params.url);
		} catch (err) {
			setTimeout(() => {
				this.dispatchEvent(new CustomEvent("error", { detail: "Failed to create connection: " + err }));
				this.setStatus(Client.Status.DISCONNECTED);
			}, 0);
			return;
		}
		this.ws.addEventListener("open", this.handleOpen.bind(this));
		this.ws.addEventListener("message", this.handleMessage.bind(this));

		this.ws.addEventListener("close", () => {
			console.log("Connection closed");
			this.ws = null;
			this.setStatus(Client.Status.DISCONNECTED);
		});

		this.ws.addEventListener("error", () => {
			this.dispatchEvent(new CustomEvent("error", { detail: "Connection error" }));
		});
	}

	disconnect() {
		if (this.ws) {
			this.ws.close(1000);
		}
	}

	setStatus(status) {
		if (this.status === status) {
			return;
		}
		this.status = status;
		this.dispatchEvent(new CustomEvent("status"));
	}

	handleOpen() {
		console.log("Connection opened");
		this.setStatus(Client.Status.REGISTERING);

		this.nick = this.params.nick;

		this.send({ command: "CAP", params: ["LS", "302"] });
		if (this.params.pass) {
			this.send({ command: "PASS", params: [this.params.pass] });
		}
		this.send({ command: "NICK", params: [this.nick] });
		this.send({
			command: "USER",
			params: [this.params.username, "0", "*", this.params.realname],
		});
	}

	handleMessage(event) {
		var msg = irc.parseMessage(event.data);
		console.log("Received:", msg);

		var msgBatch = null;
		if (msg.tags["batch"]) {
			msgBatch = this.batches.get(msg.tags["batch"]);
			if (msgBatch) {
				msgBatch.messages.push(msg);
			}
		}

		var deleteBatch = null;
		switch (msg.command) {
		case irc.RPL_WELCOME:
			if (this.params.saslPlain && this.availableCaps["sasl"] === undefined) {
				console.error("Server doesn't support SASL PLAIN");
				this.disconnect();
				return;
			}

			console.log("Registration complete");
			this.setStatus(Client.Status.REGISTERED);
			break;
		case "CAP":
			this.handleCap(msg);
			break;
		case "AUTHENTICATE":
			this.handleAuthenticate(msg);
			break;
		case irc.RPL_LOGGEDIN:
			console.log("Logged in");
			break;
		case irc.RPL_LOGGEDOUT:
			console.log("Logged out");
			break;
		case irc.RPL_SASLSUCCESS:
			console.log("SASL authentication success");
			if (this.status != Client.Status.REGISTERED) {
				this.send({ command: "CAP", params: ["END"] });
			}
			break;
		case irc.ERR_NICKLOCKED:
		case irc.ERR_SASLFAIL:
		case irc.ERR_SASLTOOLONG:
		case irc.ERR_SASLABORTED:
		case irc.ERR_SASLALREADY:
			this.dispatchEvent(new CustomEvent("error", { detail: "SASL error (" + msg.command + "): " + msg.params[1] }));
			this.disconnect();
			break;
		case "PING":
			this.send({ command: "PONG", params: [msg.params[0]] });
			break;
		case "NICK":
			var newNick = msg.params[0];
			if (msg.prefix.name == this.nick) {
				this.nick = newNick;
			}
			break;
		case "BATCH":
			var enter = msg.params[0].startsWith("+");
			var name = msg.params[0].slice(1);
			if (enter) {
				var batch = {
					name,
					type: msg.params[1],
					params: msg.params.slice(2),
					parent: msgBatch,
					messages: [],
				};
				this.batches.set(name, batch);
			} else {
				deleteBatch = name;
			}
			break;
		case "ERROR":
			this.dispatchEvent(new CustomEvent("error", { detail: "Fatal IRC error: " + msg.params[0] }));
			this.disconnect();
			break;
		case irc.ERR_PASSWDMISMATCH:
		case irc.ERR_ERRONEUSNICKNAME:
		case irc.ERR_NICKNAMEINUSE:
		case irc.ERR_NICKCOLLISION:
		case irc.ERR_UNAVAILRESOURCE:
		case irc.ERR_NOPERMFORHOST:
		case irc.ERR_YOUREBANNEDCREEP:
			this.dispatchEvent(new CustomEvent("error", { detail: "Error (" + msg.command + "): " + msg.params[msg.params.length - 1] }));
			if (this.status != Client.Status.REGISTERED) {
				this.disconnect();
			}
			break;
		}

		this.dispatchEvent(new CustomEvent("message", {
			detail: { message: msg, batch: msgBatch },
		}));

		// Delete after firing the message event so that handlers can access
		// the batch
		if (deleteBatch) {
			this.batches.delete(name);
		}
	}

	addAvailableCaps(s) {
		var l = s.split(" ");
		l.forEach((s) => {
			var parts = s.split("=");
			var k = parts[0].toLowerCase();
			var v = "";
			if (parts.length > 1) {
				v = parts[1];
			}
			this.availableCaps[k] = v;
		});
	}

	supportsSASL(mech) {
		var saslCap = this.availableCaps["sasl"];
		if (saslCap === undefined) {
			return false;
		}
		return saslCap.split(",").includes(mech);
	}

	requestCaps(extra) {
		var reqCaps = extra || [];

		permanentCaps.forEach((cap) => {
			if (this.availableCaps[cap] !== undefined && !this.enabledCaps[cap]) {
				reqCaps.push(cap);
			}
		});

		if (reqCaps.length > 0) {
			this.send({ command: "CAP", params: ["REQ", reqCaps.join(" ")] });
		}
	}

	handleCap(msg) {
		var subCmd = msg.params[1];
		var args = msg.params.slice(2);
		switch (subCmd) {
		case "LS":
			this.addAvailableCaps(args[args.length - 1]);
			if (args[0] != "*") {
				console.log("Available server caps:", this.availableCaps);

				var reqCaps = [];
				var capEnd = true;
				if (this.params.saslPlain && this.supportsSASL("PLAIN")) {
					// CAP END is deferred after authentication finishes
					reqCaps.push("sasl");
					capEnd = false;
				}

				this.requestCaps(reqCaps);

				if (this.status != Client.Status.REGISTERED && capEnd) {
					this.send({ command: "CAP", params: ["END"] });
				}
			}
			break;
		case "NEW":
			this.addAvailableCaps(args[0]);
			console.log("Server added available caps:", args[0]);
			this.requestCaps();
			break;
		case "DEL":
			args[0].split(" ").forEach((cap) => {
				cap = cap.toLowerCase();
				delete this.availableCaps[cap];
				delete this.enabledCaps[cap];
			});
			console.log("Server removed available caps:", args[0]);
			break;
		case "ACK":
			console.log("Server ack'ed caps:", args[0]);
			args[0].split(" ").forEach((cap) => {
				cap = cap.toLowerCase();
				this.enabledCaps[cap] = true;

				if (cap == "sasl" && this.params.saslPlain) {
					console.log("Starting SASL PLAIN authentication");
					this.send({ command: "AUTHENTICATE", params: ["PLAIN"] });
				}
			});
			break;
		case "NAK":
			console.log("Server nak'ed caps:", args[0]);
			if (this.status != Client.Status.REGISTERED) {
				this.send({ command: "CAP", params: ["END"] });
			}
			break;
		}
	}

	handleAuthenticate(msg) {
		var challengeStr = msg.params[0];

		// For now only PLAIN is supported
		if (challengeStr != "+") {
			this.dispatchEvent(new CustomEvent("error", { detail: "Expected an empty challenge, got: " + challengeStr }));
			this.send({ command: "AUTHENTICATE", params: ["*"] });
			return;
		}

		var respStr = btoa("\0" + this.params.saslPlain.username + "\0" + this.params.saslPlain.password);
		this.send({ command: "AUTHENTICATE", params: [respStr] });
	}

	send(msg) {
		this.ws.send(irc.formatMessage(msg));
		console.log("Sent:", msg);
	}

	/* Execute a command that expects a response. `done` is called with message
	 * events until it returns a truthy value. */
	roundtrip(msg, done) {
		return new Promise((resolve, reject) => {
			var handleMessage = (event) => {
				try {
					var result = done(event);
					if (result) {
						this.removeEventListener("message", handleMessage);
						resolve(result);
					}
				} catch (err) {
					this.removeEventListener("message", handleMessage);
					reject(err);
				}
			};

			this.addEventListener("message", handleMessage);
			this.send(msg);
		});
	}
}
