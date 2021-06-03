import * as irc from "./irc.js";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = [
	"away-notify",
	"batch",
	"echo-message",
	"invite-notify",
	"message-tags",
	"multi-prefix",
	"server-time",
	"setname",

	"draft/chathistory",

	"soju.im/bouncer-networks",
];

const RECONNECT_DELAY_SEC = 10;

export default class Client extends EventTarget {
	static Status = {
		DISCONNECTED: "disconnected",
		CONNECTING: "connecting",
		REGISTERING: "registering",
		REGISTERED: "registered",
	};

	status = Client.Status.DISCONNECTED;
	serverPrefix = null;
	nick = null;
	availableCaps = {};
	enabledCaps = {};
	isupport = new Map();

	ws = null;
	params = {
		url: null,
		username: null,
		realname: null,
		nick: null,
		pass: null,
		saslPlain: null,
		bouncerNetwork: null,
	};
	batches = new Map();
	autoReconnect = true;
	reconnectTimeoutID = null;
	pingIntervalID = null;
	pendingHistory = Promise.resolve(null);
	cm = irc.CaseMapping.RFC1459;
	whoisDB = new irc.CaseMapMap(null, irc.CaseMapping.RFC1459);

	constructor(params) {
		super();

		this.params = { ...this.params, ...params };

		this.reconnect();
	}

	reconnect() {
		var autoReconnect = this.autoReconnect;
		this.disconnect();
		this.autoReconnect = autoReconnect;

		this.setStatus(Client.Status.CONNECTING);

		try {
			this.ws = new WebSocket(this.params.url);
		} catch (err) {
			console.error("Failed to create connection:", err);
			setTimeout(() => {
				this.dispatchEvent(new CustomEvent("error", { detail: "Failed to create connection: " + err }));
				this.setStatus(Client.Status.DISCONNECTED);
			}, 0);
			return;
		}
		this.ws.addEventListener("open", this.handleOpen.bind(this));
		this.ws.addEventListener("message", this.handleMessage.bind(this));

		this.ws.addEventListener("close", (event) => {
			console.log("Connection closed (code: " + event.code + ")");

			this.ws = null;
			this.setStatus(Client.Status.DISCONNECTED);
			this.nick = null;
			this.serverPrefix = null;
			this.availableCaps = {};
			this.enabledCaps = {};
			this.batches = new Map();
			this.pendingHistory = Promise.resolve(null);
			this.isupport = new Map();

			if (this.autoReconnect) {
				console.info("Reconnecting to server in " + RECONNECT_DELAY_SEC + " seconds");
				clearTimeout(this.reconnectTimeoutID);
				this.reconnectTimeoutID = setTimeout(() => {
					this.reconnect();
				}, RECONNECT_DELAY_SEC * 1000);
			}
		});

		this.ws.addEventListener("error", () => {
			this.dispatchEvent(new CustomEvent("error", { detail: "Connection error" }));
		});
	}

	disconnect() {
		this.autoReconnect = false;

		clearTimeout(this.reconnectTimeoutID);
		this.reconnectTimeoutID = null;

		this.setPingInterval(0);

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
		console.debug("Received:", msg);

		// If the prefix is missing, assume it's coming from the server on the
		// other end of the connection
		if (!msg.prefix) {
			msg.prefix = this.serverPrefix;
		}

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
				this.dispatchEvent(new CustomEvent("error", { detail: "Server doesn't support SASL PLAIN" }));
				this.disconnect();
				return;
			}

			console.log("Registration complete");
			this.setStatus(Client.Status.REGISTERED);
			this.serverPrefix = msg.prefix;
			break;
		case irc.RPL_ISUPPORT:
			var tokens = msg.params.slice(1, -1);
			var changed = irc.parseISUPPORT(tokens, this.isupport);
			if (changed.indexOf("CASEMAPPING") >= 0) {
				this.setCaseMapping(this.isupport.get("CASEMAPPING"));
			}
			break;
		case irc.RPL_ENDOFMOTD:
		case irc.ERR_NOMOTD:
			// These messages are used to indicate the end of the ISUPPORT list
			if (!this.isupport.has("CASEMAPPING")) {
				// Server didn't send any CASEMAPPING token, assume RFC 1459
				this.setCaseMapping("rfc1459");
			}
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
				if (this.enabledCaps["soju.im/bouncer-networks"] && this.params.bouncerNetwork) {
					this.send({ command: "BOUNCER", params: ["BIND", this.params.bouncerNetwork] });
				}
				this.send({ command: "CAP", params: ["END"] });
			}
			break;
		case irc.RPL_WHOISUSER:
		case irc.RPL_WHOISSERVER:
		case irc.RPL_WHOISOPERATOR:
		case irc.RPL_WHOISIDLE:
		case irc.RPL_WHOISCHANNELS:
		case irc.RPL_ENDOFWHOIS:
			var nick = msg.params[1];
			if (!this.whoisDB.has(nick)) {
				this.whoisDB.set(nick, {});
			}
			this.whoisDB.get(nick)[msg.command] = msg;
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
		case "FAIL":
			if (msg.params[0] === "BOUNCER" && msg.params[2] === "BIND") {
				this.dispatchEvent(new CustomEvent("error", {
					detail: "Failed to bind to bouncer network: " + msg.params[3],
				}));
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

	who(mask) {
		var msg = { command: "WHO", params: [mask] };
		var l = [];
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
			case irc.RPL_WHOREPLY:
				// TODO: match with mask
				l.push(msg);
				break;
			case irc.RPL_ENDOFWHO:
				if (msg.params[1] === mask) {
					return l;
				}
				break;
			}
		});
	}

	whois(target) {
		var targetCM = this.cm(target);
		var msg = { command: "WHOIS", params: [target] };
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
			case irc.RPL_ENDOFWHOIS:
				var nick = msg.params[1];
				if (this.cm(nick) === targetCM) {
					return this.whoisDB.get(nick);
				}
				break;
			case irc.ERR_NOSUCHNICK:
				var nick = msg.params[1];
				if (this.cm(nick) === targetCM) {
					throw msg;
				}
				break;
			}
		});
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

				if (!this.params.bouncerNetwork && this.availableCaps["soju.im/bouncer-networks-notify"] !== undefined) {
					reqCaps.push("soju.im/bouncer-networks-notify");
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
		if (!this.ws) {
			throw new Error("Failed to send IRC message " + msg.command + ": socket is closed");
		}
		this.ws.send(irc.formatMessage(msg));
		console.debug("Sent:", msg);
	}

	setCaseMapping(name) {
		this.cm = irc.CaseMapping.byName(name);
		if (!this.cm) {
			console.error("Unsupported case-mapping '" + name + "', falling back to RFC 1459");
			this.cm = irc.CaseMapping.RFC1459;
		}

		this.whoisDB = new irc.CaseMapMap(this.whoisDB, this.cm);
	}

	isMyNick(nick) {
		return this.cm(nick) == this.cm(this.nick);
	}

	setPingInterval(sec) {
		clearInterval(this.pingIntervalID);
		this.pingIntervalID = null;

		if (sec <= 0) {
			return;
		}

		this.pingIntervalID = setInterval(() => {
			if (this.ws) {
				this.send({ command: "PING", params: ["gamja"] });
			}
		}, sec * 1000);
	}

	/* Execute a command that expects a response. `done` is called with message
	 * events until it returns a truthy value. */
	roundtrip(msg, done) {
		return new Promise((resolve, reject) => {
			var handleMessage = (event) => {
				try {
					var result = done(event.detail.message);
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

	fetchBatch(msg, batchType) {
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
			case "BATCH":
				var enter = msg.params[0].startsWith("+");
				var name = msg.params[0].slice(1);
				if (enter) {
					break;
				}
				var batch = this.batches.get(name);
				if (batch.type === batchType) {
					return batch;
				}
				break;
			case "FAIL":
				if (msg.params[0] === msg.command) {
					throw msg;
				}
				break;
			}
		});
	}

	roundtripChatHistory(params) {
		// Don't send multiple CHATHISTORY commands in parallel, we can't
		// properly handle batches and errors.
		this.pendingHistory = this.pendingHistory.catch(() => {}).then(() => {
			var msg = {
				command: "CHATHISTORY",
				params,
			};
			return this.fetchBatch(msg, "chathistory");
		});
		return this.pendingHistory;
	}

	chatHistoryPageSize() {
		if (this.isupport.has("CHATHISTORY")) {
			var pageSize = parseInt(this.isupport.get("CHATHISTORY"), 10);
			if (pageSize > 0) {
				return pageSize;
			}
		}
		return 100;
	}

	/* Fetch one page of history before the given date. */
	fetchHistoryBefore(target, before, limit) {
		var max = Math.min(limit, this.chatHistoryPageSize());
		var params = ["BEFORE", target, "timestamp=" + before, max];
		return this.roundtripChatHistory(params).then((batch) => {
			return { more: batch.messages.length >= max };
		});
	}

	/* Fetch history in ascending order. */
	fetchHistoryBetween(target, after, before, limit) {
		var max = Math.min(limit, this.chatHistoryPageSize());
		var params = ["AFTER", target, "timestamp=" + after.time, max];
		return this.roundtripChatHistory(params).then((batch) => {
			limit -= batch.messages.length;
			if (limit <= 0) {
				throw new Error("Cannot fetch all chat history: too many messages");
			}
			if (batch.messages.length == max) {
				// There are still more messages to fetch
				after.time = batch.messages[batch.messages.length - 1].tags.time;
				return this.fetchHistoryBetween(target, after, before, limit);
			}
			return null;
		});
	}

	fetchHistoryTargets(t1, t2) {
		var msg = {
			command: "CHATHISTORY",
			params: ["TARGETS", "timestamp=" + t1, "timestamp=" + t2, 1000],
		};
		return this.fetchBatch(msg, "draft/chathistory-targets").then((batch) => {
			return batch.messages.map((msg) => {
				if (msg.command != "CHATHISTORY" || msg.params[0] != "TARGETS") {
					throw new Error("Cannot fetch chat history targets: unexpected message " + msg);
				}
				return {
					name: msg.params[1],
					latestMessage: msg.params[2],
				};
			});
		});
	}

	listBouncerNetworks() {
		if (!this.enabledCaps["soju.im/bouncer-networks"]) {
			return Promise.reject(new Error("Server doesn't support the BOUNCER extension"));
		}

		var req = { command: "BOUNCER", params: ["LISTNETWORKS"] };
		return this.fetchBatch(req, "soju.im/bouncer-networks").then((batch) => {
			var networks = new Map();
			for (var msg of batch.messages) {
				console.assert(msg.command === "BOUNCER" && msg.params[0] === "NETWORK");
				var id = msg.params[1];
				var params = irc.parseTags(msg.params[2]);
				networks.set(id, params);
			}
			return networks;
		});
	}
}
