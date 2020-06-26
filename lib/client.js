import * as irc from "./irc.js";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = ["message-tags", "server-time", "multi-prefix", "away-notify", "echo-message"];

export default class Client extends EventTarget {
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
	registered = false;
	availableCaps = {};
	enabledCaps = {};

	constructor(params) {
		super();

		this.params = Object.assign(this.params, params);

		try {
			this.ws = new WebSocket(params.url);
		} catch (err) {
			console.error("Failed to create connection:", err);
			setTimeout(() => this.dispatchEvent(new CustomEvent("close")), 0);
			return;
		}

		this.ws.addEventListener("open", this.handleOpen.bind(this));
		this.ws.addEventListener("message", this.handleMessage.bind(this));

		this.ws.addEventListener("close", () => {
			console.log("Connection closed");
			this.dispatchEvent(new CustomEvent("close"));
		});

		this.ws.addEventListener("error", () => {
			console.error("Connection error");
		});
	}

	handleOpen() {
		console.log("Connection opened");

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

		switch (msg.command) {
		case irc.RPL_WELCOME:
			if (this.params.saslPlain && this.availableCaps["sasl"] === undefined) {
				console.error("Server doesn't support SASL PLAIN");
				this.close();
				return;
			}

			console.log("Registration complete");
			this.registered = true;
			break;
		case irc.ERR_PASSWDMISMATCH:
			console.error("Password mismatch");
			this.close();
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
			if (!this.registered) {
				this.send({ command: "CAP", params: ["END"] });
			}
			break;
		case irc.ERR_NICKLOCKED:
		case irc.ERR_SASLFAIL:
		case irc.ERR_SASLTOOLONG:
		case irc.ERR_SASLABORTED:
		case irc.ERR_SASLALREADY:
			console.error("SASL error:", msg);
			this.close();
			break;
		case "NICK":
			var newNick = msg.params[0];
			if (msg.prefix.name == this.nick) {
				this.nick = newNick;
			}
			break;
		}

		this.dispatchEvent(new CustomEvent("message", {
			detail: { message: msg },
		}));
	}

	addAvailableCaps(s) {
		var l = s.split(" ");
		l.forEach((s) => {
			var parts = s.split("=");
			var k = parts[0];
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

				if (!this.registered && capEnd) {
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
				delete this.availableCaps[cap];
				delete this.enabledCaps[cap];
			});
			console.log("Server removed available caps:", args[0]);
			break;
		case "ACK":
			console.log("Server ack'ed caps:", args[0]);
			args[0].split(" ").forEach((cap) => {
				this.enabledCaps[cap] = true;

				if (cap == "sasl" && this.params.saslPlain) {
					console.log("Starting SASL PLAIN authentication");
					this.send({ command: "AUTHENTICATE", params: ["PLAIN"] });
				}
			});
			break;
		case "NAK":
			console.log("Server nak'ed caps:", args[0]);
			if (!this.registered) {
				this.send({ command: "CAP", params: ["END"] });
			}
			break;
		}
	}

	handleAuthenticate(msg) {
		var challengeStr = msg.params[0];

		// For now only PLAIN is supported
		if (challengeStr != "+") {
			console.error("Expected an empty challenge, got:", challengeStr);
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

	close() {
		this.ws.close(1000);
		this.registered = false;
	}
}
