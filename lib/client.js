import * as irc from "./irc.js";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = [
	"account-notify",
	"away-notify",
	"batch",
	"chghost",
	"echo-message",
	"extended-join",
	"invite-notify",
	"labeled-response",
	"message-tags",
	"multi-prefix",
	"sasl",
	"server-time",
	"setname",

	"draft/account-registration",
	"draft/chathistory",
	"draft/event-playback",
	"draft/extended-monitor",

	"soju.im/bouncer-networks",
];

const RECONNECT_DELAY_SEC = 10;

// WebSocket status codes
// https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
const NORMAL_CLOSURE = 1000;
const GOING_AWAY = 1001;
const UNSUPPORTED_DATA = 1003;

// See https://github.com/quakenet/snircd/blob/master/doc/readme.who
// Sorted by order of appearance in RPL_WHOSPCRPL
const WHOX_FIELDS = {
	"channel": "c",
	"username": "u",
	"hostname": "h",
	"server": "s",
	"nick": "n",
	"flags": "f",
	"account": "a",
	"realname": "r",
};

let lastLabel = 0;
let lastWhoxToken = 0;

export default class Client extends EventTarget {
	static Status = {
		DISCONNECTED: "disconnected",
		CONNECTING: "connecting",
		REGISTERING: "registering",
		REGISTERED: "registered",
	};

	status = Client.Status.DISCONNECTED;
	serverPrefix = { name: "*" };
	nick = null;
	supportsCap = false;
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
		saslExternal: false,
		bouncerNetwork: null,
	};
	debug = false;
	batches = new Map();
	autoReconnect = true;
	reconnectTimeoutID = null;
	pingIntervalID = null;
	pendingCmds = {
		WHO: Promise.resolve(null),
		CHATHISTORY: Promise.resolve(null),
	};
	cm = irc.CaseMapping.RFC1459;
	monitored = new irc.CaseMapMap(null, irc.CaseMapping.RFC1459);
	pendingLists = new irc.CaseMapMap(null, irc.CaseMapping.RFC1459);
	whoxQueries = new Map();

	constructor(params) {
		super();

		this.params = { ...this.params, ...params };

		this.reconnect();
	}

	reconnect() {
		let autoReconnect = this.autoReconnect;
		this.disconnect();
		this.autoReconnect = autoReconnect;

		console.log("Connecting to " + this.params.url);
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

		this.ws.addEventListener("message", (event) => {
			try {
				this.handleMessage(event);
			} catch (err) {
				this.dispatchEvent(new CustomEvent("error", { detail: err }));
				this.disconnect();
			}
		});

		this.ws.addEventListener("close", (event) => {
			console.log("Connection closed (code: " + event.code + ")");

			if (event.code !== NORMAL_CLOSURE && event.code !== GOING_AWAY) {
				this.dispatchEvent(new CustomEvent("error", { detail: "Connection error" }));
			}

			this.ws = null;
			this.setStatus(Client.Status.DISCONNECTED);
			this.nick = null;
			this.serverPrefix = null;
			this.availableCaps = {};
			this.enabledCaps = {};
			this.batches = new Map();
			Object.keys(this.pendingCmds).forEach((k) => {
				this.pendingCmds[k] = Promise.resolve(null);
			});
			this.isupport = new Map();
			this.monitored = new irc.CaseMapMap(null, irc.CaseMapping.RFC1459);

			if (this.autoReconnect) {
				if (!navigator.onLine) {
					console.info("Waiting for network to go back online");
					const handleOnline = () => {
						window.removeEventListener("online", handleOnline);
						this.reconnect();
					};
					window.addEventListener("online", handleOnline);
				} else {
					console.info("Reconnecting to server in " + RECONNECT_DELAY_SEC + " seconds");
					clearTimeout(this.reconnectTimeoutID);
					this.reconnectTimeoutID = setTimeout(() => {
						this.reconnect();
					}, RECONNECT_DELAY_SEC * 1000);
				}
			}
		});
	}

	disconnect() {
		this.autoReconnect = false;

		clearTimeout(this.reconnectTimeoutID);
		this.reconnectTimeoutID = null;

		this.setPingInterval(0);

		if (this.ws) {
			this.ws.close(NORMAL_CLOSURE);
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

	pushPendingList(k, msg) {
		let l = this.pendingLists.get(k);
		if (!l) {
			l = [];
			this.pendingLists.set(k, l);
		}
		l.push(msg);
	}

	endPendingList(k, msg) {
		msg.list = this.pendingLists.get(k) || [];
		this.pendingLists.delete(k);
	}

	handleMessage(event) {
		if (typeof event.data !== "string") {
			console.error("Received unsupported data type:", event.data);
			this.ws.close(UNSUPPORTED_DATA);
			return;
		}

		let msg = irc.parseMessage(event.data);
		if (this.debug) {
			console.debug("Received:", msg);
		}

		// If the prefix is missing, assume it's coming from the server on the
		// other end of the connection
		if (!msg.prefix) {
			msg.prefix = this.serverPrefix;
		}

		let msgBatch = null;
		if (msg.tags["batch"]) {
			msgBatch = this.batches.get(msg.tags["batch"]);
			if (msgBatch) {
				msg.batch = msgBatch;
			}
		}

		let deleteBatch = null;
		let k;
		switch (msg.command) {
		case irc.RPL_WELCOME:
			if (this.params.saslPlain && !this.supportsCap) {
				this.dispatchEvent(new CustomEvent("error", { detail: "Server doesn't support SASL PLAIN" }));
				this.disconnect();
				return;
			}

			if (msg.prefix) {
				this.serverPrefix = msg.prefix;
			}

			console.log("Registration complete");
			this.setStatus(Client.Status.REGISTERED);
			break;
		case irc.RPL_ISUPPORT:
			let tokens = msg.params.slice(1, -1);
			let changed = irc.parseISUPPORT(tokens, this.isupport);
			if (changed.indexOf("CASEMAPPING") >= 0) {
				this.setCaseMapping(this.isupport.get("CASEMAPPING"));
			}
			if (changed.indexOf("MONITOR") >= 0 && this.isupport.has("MONITOR") && this.monitored.size > 0) {
				let targets = Array.from(this.monitored.keys()).slice(0, this.maxMonitorTargets());
				this.send({ command: "MONITOR", params: ["+", targets.join(",")] });
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
			// Both PLAIN and EXTERNAL expect an empty challenge
			let challengeStr = msg.params[0];
			if (challengeStr != "+") {
				this.dispatchEvent(new CustomEvent("error", { detail: "Expected an empty challenge, got: " + challengeStr }));
				this.send({ command: "AUTHENTICATE", params: ["*"] });
			}
			break;
		case irc.RPL_LOGGEDIN:
			console.log("Logged in");
			break;
		case irc.RPL_LOGGEDOUT:
			console.log("Logged out");
			break;
		case irc.RPL_NAMREPLY:
			this.pushPendingList("NAMES " + msg.params[2], msg);
			break;
		case irc.RPL_ENDOFNAMES:
			this.endPendingList("NAMES " + msg.params[1], msg);
			break;
		case irc.RPL_WHOISUSER:
		case irc.RPL_WHOISSERVER:
		case irc.RPL_WHOISOPERATOR:
		case irc.RPL_WHOISIDLE:
		case irc.RPL_WHOISCHANNELS:
			this.pushPendingList("WHOIS " + msg.params[1], msg);
			break;
		case irc.RPL_ENDOFWHOIS:
			this.endPendingList("WHOIS " + msg.params[1], msg);
			break;
		case irc.RPL_WHOREPLY:
		case irc.RPL_WHOSPCRPL:
			this.pushPendingList("WHO", msg);
			break;
		case irc.RPL_ENDOFWHO:
			this.endPendingList("WHO", msg);
			break;
		case "PING":
			this.send({ command: "PONG", params: [msg.params[0]] });
			break;
		case "NICK":
			let newNick = msg.params[0];
			if (this.isMyNick(msg.prefix.name)) {
				this.nick = newNick;
			}
			break;
		case "BATCH":
			let enter = msg.params[0].startsWith("+");
			let name = msg.params[0].slice(1);
			if (enter) {
				let batch = {
					name,
					type: msg.params[1],
					params: msg.params.slice(2),
					tags: msg.tags,
					parent: msgBatch,
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
			this.batches.delete(deleteBatch);
		}
	}

	authenticate(mechanism, params) {
		if (!this.supportsSASL(mechanism)) {
			throw new Error(`${mechanism} authentication not supported by the server`);
		}
		console.log(`Starting SASL ${mechanism} authentication`);

		// Send the first SASL response immediately to avoid a roundtrip
		let initialResp = null;
		switch (mechanism) {
		case "PLAIN":
			let respStr = btoa("\0" + params.username + "\0" + params.password);
			initialResp = { command: "AUTHENTICATE", params: [respStr] };
			break;
		case "EXTERNAL":
			initialResp = { command: "AUTHENTICATE", params: [btoa("")] };
			break;
		default:
			throw new Error(`Unknown authentication mechanism '${mechanism}'`);
		}

		let startMsg = { command: "AUTHENTICATE", params: [mechanism] };
		let promise = this.roundtrip(startMsg, (msg) => {
			switch (msg.command) {
			case irc.RPL_SASLSUCCESS:
				return true;
			case irc.ERR_NICKLOCKED:
			case irc.ERR_SASLFAIL:
			case irc.ERR_SASLTOOLONG:
			case irc.ERR_SASLABORTED:
			case irc.ERR_SASLALREADY:
				throw msg;
			}
		});
		this.send(initialResp);
		return promise;
	}

	who(mask, options) {
		let params = [mask];

		let fields = "", token = "";
		if (options && this.isupport.has("WHOX")) {
			let match = ""; // Matches exact channel or nick

			fields = "t"; // Always include token in reply
			if (options.fields) {
				options.fields.forEach((k) => {
					if (!WHOX_FIELDS[k]) {
						throw new Error(`Unknown WHOX field ${k}`);
					}
					fields += WHOX_FIELDS[k];
				});
			}

			token = String(lastWhoxToken % 1000);
			lastWhoxToken++;

			params.push(`${match}%${fields},${token}`);
			this.whoxQueries.set(token, fields);
		}

		let msg = { command: "WHO", params };
		let l = [];
		let promise = this.pendingCmds.WHO.then(() => {
			return this.roundtrip(msg, (msg) => {
				switch (msg.command) {
				case irc.RPL_WHOREPLY:
					l.push(this.parseWhoReply(msg));
					break;
				case irc.RPL_WHOSPCRPL:
					if (msg.params.length !== fields.length || msg.params[1] !== token) {
						break;
					}
					l.push(this.parseWhoReply(msg));
					break;
				case irc.RPL_ENDOFWHO:
					if (msg.params[1] === mask) {
						return l;
					}
					break;
				}
			}).finally(() => {
				this.whoxQueries.delete(token);
			});
		});
		this.pendingCmds.WHO = promise.catch(() => {});
		return promise;
	}

	parseWhoReply(msg) {
		switch (msg.command) {
		case irc.RPL_WHOREPLY:
			let last = msg.params[msg.params.length - 1];
			return {
				username: msg.params[2],
				hostname: msg.params[3],
				server: msg.params[4],
				nick: msg.params[5],
				flags: msg.params[6],
				realname: last.slice(last.indexOf(" ") + 1),
			};
		case irc.RPL_WHOSPCRPL:
			let token = msg.params[1];
			let fields = this.whoxQueries.get(token);
			if (!fields) {
				throw new Error("Unknown WHOX token: " + token);
			}
			let who = {};
			let i = 0;
			Object.keys(WHOX_FIELDS).forEach((k) => {
				if (fields.indexOf(WHOX_FIELDS[k]) < 0) {
					return;
				}

				who[k] = msg.params[2 + i];
				i++;
			});
			if (who.account === "0") {
				// WHOX uses "0" to mean "no account"
				who.account = null;
			}
			return who;
		default:
			throw new Error("Not a WHO reply: " + msg.command);
		}
	}

	whois(target) {
		let targetCM = this.cm(target);
		let msg = { command: "WHOIS", params: [target] };
		return this.roundtrip(msg, (msg) => {
			let nick;
			switch (msg.command) {
			case irc.RPL_ENDOFWHOIS:
				nick = msg.params[1];
				if (this.cm(nick) === targetCM) {
					let whois = {};
					msg.list.forEach((reply) => {
						whois[reply.command] = reply;
					});
					return whois;
				}
				break;
			case irc.ERR_NOSUCHNICK:
				nick = msg.params[1];
				if (this.cm(nick) === targetCM) {
					throw msg;
				}
				break;
			}
		});
	}

	addAvailableCaps(s) {
		let l = s.split(" ");
		l.forEach((s) => {
			let i = s.indexOf("=");
			let k = s, v = "";
			if (i >= 0) {
				k = s.slice(0, i);
				v = s.slice(i + 1);
			}
			this.availableCaps[k.toLowerCase()] = v;
		});
	}

	supportsSASL(mech) {
		let saslCap = this.availableCaps["sasl"];
		if (saslCap === undefined) {
			return false;
		}
		return saslCap.split(",").includes(mech);
	}

	checkAccountRegistrationCap(k) {
		let v = this.availableCaps["draft/account-registration"];
		if (v === undefined) {
			return false;
		}
		return v.split(",").includes(k);
	}

	requestCaps() {
		let wantCaps = [].concat(permanentCaps);
		if (!this.params.bouncerNetwork) {
			wantCaps.push("soju.im/bouncer-networks-notify");
		}

		let reqCaps = [];
		wantCaps.forEach((cap) => {
			if (this.availableCaps[cap] !== undefined && !this.enabledCaps[cap]) {
				reqCaps.push(cap);
			}
		});

		if (reqCaps.length > 0) {
			this.send({ command: "CAP", params: ["REQ", reqCaps.join(" ")] });
		}
	}

	handleCap(msg) {
		let subCmd = msg.params[1];
		let args = msg.params.slice(2);
		switch (subCmd) {
		case "LS":
			this.supportsCap = true;
			this.addAvailableCaps(args[args.length - 1]);
			if (args[0] == "*") {
				break;
			}

			console.log("Available server caps:", this.availableCaps);

			this.requestCaps();

			if (this.status !== Client.Status.REGISTERED) {
				if (this.availableCaps["sasl"] !== undefined) {
					let promise;
					if (this.params.saslPlain) {
						promise = this.authenticate("PLAIN", this.params.saslPlain);
					} else if (this.params.saslExternal) {
						promise = this.authenticate("EXTERNAL");
					}
					(promise || Promise.resolve()).catch((msg) => {
						if (msg.command) {
							this.dispatchEvent(new CustomEvent("error", {
								detail: "Authentication error (SASL " + msg.command + "): " + msg.params[1],
							}));
						}
						this.disconnect();
					});
				}

				if (this.availableCaps["soju.im/bouncer-networks"] !== undefined && this.params.bouncerNetwork) {
					this.send({ command: "BOUNCER", params: ["BIND", this.params.bouncerNetwork] });
				}

				this.send({ command: "CAP", params: ["END"] });
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

	send(msg) {
		if (!this.ws) {
			throw new Error("Failed to send IRC message " + msg.command + ": socket is closed");
		}
		this.ws.send(irc.formatMessage(msg));
		if (this.debug) {
			console.debug("Sent:", msg);
		}
	}

	setCaseMapping(name) {
		this.cm = irc.CaseMapping.byName(name);
		if (!this.cm) {
			console.error("Unsupported case-mapping '" + name + "', falling back to RFC 1459");
			this.cm = irc.CaseMapping.RFC1459;
		}

		this.pendingLists = new irc.CaseMapMap(this.pendingLists, this.cm);
		this.monitored = new irc.CaseMapMap(this.monitored, this.cm);
	}

	isServer(name) {
		return name === "*" || this.cm(name) === this.cm(this.serverPrefix.name);
	}

	isMyNick(nick) {
		return this.cm(nick) == this.cm(this.nick);
	}

	isChannel(name) {
		let chanTypes = this.isupport.get("CHANTYPES") || irc.STD_CHANTYPES;
		return chanTypes.indexOf(name[0]) >= 0;
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
		let label;
		if (this.enabledCaps["labeled-response"]) {
			lastLabel++;
			label = String(lastLabel);
			msg.tags = { ...msg.tags, label };
		}

		return new Promise((resolve, reject) => {
			let removeEventListeners;

			let handleMessage = (event) => {
				let msg = event.detail.message;

				let msgLabel = irc.getMessageLabel(msg);
				if (msgLabel && msgLabel != label) {
					return;
				}

				let result;
				try {
					result = done(msg);
				} catch (err) {
					removeEventListeners();
					reject(err);
				}
				if (result) {
					removeEventListeners();
					resolve(result);
				}

				// TODO: handle end of labeled response somehow
			};

			let handleStatus = () => {
				if (this.status === Client.Status.DISCONNECTED) {
					removeEventListeners();
					reject(new Error("Connection closed"));
				}
			};

			removeEventListeners = () => {
				this.removeEventListener("message", handleMessage);
				this.removeEventListener("status", handleStatus);
			};

			this.addEventListener("message", handleMessage);
			this.addEventListener("status", handleStatus);
			this.send(msg);
		});
	}

	fetchBatch(msg, batchType) {
		let batchName = null;
		let messages = [];
		let cmd = msg.command;
		return this.roundtrip(msg, (msg) => {
			if (batchName) {
				let batch = msg.batch;
				while (batch) {
					if (batch.name === batchName) {
						messages.push(msg);
						break;
					}
					batch = batch.parent;
				}
			}

			switch (msg.command) {
			case "BATCH":
				let enter = msg.params[0].startsWith("+");
				let name = msg.params[0].slice(1);
				if (enter && msg.params[1] === batchType) {
					batchName = name;
					break;
				}
				if (!enter && name === batchName) {
					return { ...this.batches.get(name), messages };
				}
				break;
			case "FAIL":
				if (msg.params[0] === cmd) {
					throw msg;
				}
				break;
			}
		});
	}

	roundtripChatHistory(params) {
		// Don't send multiple CHATHISTORY commands in parallel, we can't
		// properly handle batches and errors.
		let promise = this.pendingCmds.CHATHISTORY.then(() => {
			let msg = {
				command: "CHATHISTORY",
				params,
			};
			return this.fetchBatch(msg, "chathistory").then((batch) => batch.messages);
		});
		this.pendingCmds.CHATHISTORY = promise.catch(() => {});
		return promise;
	}

	chatHistoryPageSize() {
		if (this.isupport.has("CHATHISTORY")) {
			let pageSize = parseInt(this.isupport.get("CHATHISTORY"), 10);
			if (pageSize > 0) {
				return pageSize;
			}
		}
		return 100;
	}

	/* Fetch one page of history before the given date. */
	fetchHistoryBefore(target, before, limit) {
		let max = Math.min(limit, this.chatHistoryPageSize());
		let params = ["BEFORE", target, "timestamp=" + before, max];
		return this.roundtripChatHistory(params).then((messages) => {
			return { more: messages.length >= max };
		});
	}

	/* Fetch history in ascending order. */
	fetchHistoryBetween(target, after, before, limit) {
		let max = Math.min(limit, this.chatHistoryPageSize());
		let params = ["AFTER", target, "timestamp=" + after.time, max];
		return this.roundtripChatHistory(params).then((messages) => {
			limit -= messages.length;
			if (limit <= 0) {
				throw new Error("Cannot fetch all chat history: too many messages");
			}
			if (messages.length == max) {
				// There are still more messages to fetch
				after.time = messages[messages.length - 1].tags.time;
				return this.fetchHistoryBetween(target, after, before, limit);
			}
			return null;
		});
	}

	fetchHistoryTargets(t1, t2) {
		let msg = {
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

		let req = { command: "BOUNCER", params: ["LISTNETWORKS"] };
		return this.fetchBatch(req, "soju.im/bouncer-networks").then((batch) => {
			let networks = new Map();
			for (let msg of batch.messages) {
				console.assert(msg.command === "BOUNCER" && msg.params[0] === "NETWORK");
				let id = msg.params[1];
				let params = irc.parseTags(msg.params[2]);
				networks.set(id, params);
			}
			return networks;
		});
	}

	maxMonitorTargets() {
		if (!this.isupport.has("MONITOR")) {
			return 0;
		}
		let v = this.isupport.get("MONITOR");
		if (v === "") {
			return Infinity;
		}
		return parseInt(v, 10);
	}

	monitor(target) {
		if (this.monitored.has(target)) {
			return;
		}

		this.monitored.set(target, true);

		// TODO: add poll-based fallback when MONITOR is not supported
		if (this.monitored.size + 1 > this.maxMonitorTargets()) {
			return;
		}

		this.send({ command: "MONITOR", params: ["+", target] });
	}

	unmonitor(target) {
		if (!this.monitored.has(target)) {
			return;
		}

		this.monitored.delete(target);

		if (!this.isupport.has("MONITOR")) {
			return;
		}

		this.send({ command: "MONITOR", params: ["-", target] });
	}

	createBouncerNetwork(attrs) {
		let msg = {
			command: "BOUNCER",
			params: ["ADDNETWORK", irc.formatTags(attrs)],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command === "BOUNCER" && msg.params[0] === "ADDNETWORK") {
				return msg.params[1];
			}
		});
	}

	registerAccount(email, password) {
		let msg = {
			command: "REGISTER",
			params: ["*", email || "*", password],
		};
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
			case "REGISTER":
				let result = msg.params[0];
				return {
					verificationRequired: result === "VERIFICATION_REQUIRED",
					account: msg.params[1],
					message: msg.params[2],
				};
			case "FAIL":
				if (msg.params[0] === "REGISTER") {
					throw msg;
				}
				break;
			}
		});
	}

	verifyAccount(account, code) {
		let msg = {
			command: "VERIFY",
			params: [account, code],
		};
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
			case "VERIFY":
				return { message: msg.params[2] };
			case "FAIL":
				if (msg.params[0] === "VERIFY") {
					throw msg;
				}
				break;
			}
		});
	}
}
