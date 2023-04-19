import * as irc from "./irc.js";
import * as base64 from "./base64.js";

// Static list of capabilities that are always requested when supported by the
// server
const permanentCaps = [
	"account-notify",
	"away-notify",
	"batch",
	"chghost",
	"echo-message",
	"extended-join",
	"extended-monitor",
	"invite-notify",
	"labeled-response",
	"message-tags",
	"multi-prefix",
	"sasl",
	"server-time",
	"setname",

	"draft/account-registration",
	"draft/chathistory",
	"draft/extended-monitor",
	"draft/read-marker",

	"soju.im/bouncer-networks",
];

const RECONNECT_MIN_DELAY_MSEC = 10 * 1000; // 10s
const RECONNECT_MAX_DELAY_MSEC = 10 * 60 * 1000; // 10min

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

class IRCError extends Error {
	constructor(msg) {
		let text;
		if (msg.params.length > 0) {
			// IRC errors have a human-readable message as last param
			text = msg.params[msg.params.length - 1];
		} else {
			text = `unknown error (${msg.command})`;
		}
		super(text);

		this.msg = msg;
	}
}

/**
 * Implements a simple exponential backoff.
 */
class Backoff {
	n = 0;

	constructor(min, max) {
		this.min = min;
		this.max = max;
	}

	reset() {
		this.n = 0;
	}

	next() {
		if (this.n === 0) {
			this.n = 1;
			return this.min;
		}

		let dur = this.n * this.min;
		if (dur > this.max) {
			dur = this.max;
		} else {
			this.n *= 2;
		}

		return dur;
	}
}

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
	caps = new irc.CapRegistry();
	isupport = new irc.Isupport();

	ws = null;
	params = {
		url: null,
		username: null,
		realname: null,
		nick: null,
		pass: null,
		saslPlain: null,
		saslExternal: false,
		saslOauthBearer: null,
		bouncerNetwork: null,
		ping: 0,
		eventPlayback: true,
	};
	debug = false;
	batches = new Map();
	autoReconnect = true;
	reconnectTimeoutID = null;
	reconnectBackoff = new Backoff(RECONNECT_MIN_DELAY_MSEC, RECONNECT_MAX_DELAY_MSEC);
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
				this.dispatchError(new Error("Failed to create connection", { cause: err }));
				this.setStatus(Client.Status.DISCONNECTED);
			}, 0);
			return;
		}
		this.ws.addEventListener("open", this.handleOpen.bind(this));

		this.ws.addEventListener("message", (event) => {
			try {
				this.handleMessage(event);
			} catch (err) {
				this.dispatchError(err);
				this.disconnect();
			}
		});

		this.ws.addEventListener("close", (event) => {
			console.log("Connection closed (code: " + event.code + ")");

			if (event.code !== NORMAL_CLOSURE && event.code !== GOING_AWAY) {
				this.dispatchError(new Error("Connection error"));
			}

			this.ws = null;
			this.setStatus(Client.Status.DISCONNECTED);
			this.nick = null;
			this.serverPrefix = null;
			this.caps = new irc.CapRegistry();
			this.batches = new Map();
			Object.keys(this.pendingCmds).forEach((k) => {
				this.pendingCmds[k] = Promise.resolve(null);
			});
			this.isupport = new irc.Isupport();
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
					let delay = this.reconnectBackoff.next();
					console.info("Reconnecting to server in " + (delay / 1000) + " seconds");
					clearTimeout(this.reconnectTimeoutID);
					this.reconnectTimeoutID = setTimeout(() => {
						this.reconnect();
					}, delay);
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

	dispatchError(err) {
		this.dispatchEvent(new CustomEvent("error", { detail: err }));
	}

	handleOpen() {
		console.log("Connection opened");
		this.setStatus(Client.Status.REGISTERING);

		this.reconnectBackoff.reset();
		this.setPingInterval(this.params.ping);

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
		if (!msg.tags) {
			msg.tags = {};
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
				this.dispatchError(new Error("Server doesn't support SASL PLAIN"));
				this.disconnect();
				return;
			}

			if (msg.prefix) {
				this.serverPrefix = msg.prefix;
			}
			this.nick = msg.params[0];

			console.log("Registration complete");
			this.setStatus(Client.Status.REGISTERED);
			break;
		case irc.RPL_ISUPPORT:
			let prevMaxMonitorTargets = this.isupport.monitor();

			let tokens = msg.params.slice(1, -1);
			this.isupport.parse(tokens);
			this.updateCaseMapping();

			let maxMonitorTargets = this.isupport.monitor();
			if (prevMaxMonitorTargets === 0 && this.monitored.size > 0 && maxMonitorTargets > 0) {
				let targets = Array.from(this.monitored.keys()).slice(0, maxMonitorTargets);
				this.send({ command: "MONITOR", params: ["+", targets.join(",")] });
			}
			break;
		case irc.RPL_ENDOFMOTD:
		case irc.ERR_NOMOTD:
			// These messages are used to indicate the end of the ISUPPORT list
			if (!this.isupport.raw.has("CASEMAPPING")) {
				// Server didn't send any CASEMAPPING token, assume RFC 1459
				this.updateCaseMapping();
			}
			break;
		case "CAP":
			this.handleCap(msg);
			break;
		case "AUTHENTICATE":
			// Both PLAIN and EXTERNAL expect an empty challenge
			let challengeStr = msg.params[0];
			if (challengeStr != "+") {
				this.dispatchError(new Error("Expected an empty challenge, got: " + challengeStr));
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
			this.dispatchError(new IRCError(msg));
			this.disconnect();
			break;
		case irc.ERR_PASSWDMISMATCH:
		case irc.ERR_ERRONEUSNICKNAME:
		case irc.ERR_NICKNAMEINUSE:
		case irc.ERR_NICKCOLLISION:
		case irc.ERR_UNAVAILRESOURCE:
		case irc.ERR_NOPERMFORHOST:
		case irc.ERR_YOUREBANNEDCREEP:
			this.dispatchError(new IRCError(msg));
			if (this.status != Client.Status.REGISTERED) {
				this.disconnect();
			}
			break;
		case "FAIL":
			if (this.status === Client.Status.REGISTERED) {
				break;
			}
			let reason = msg.params[msg.params.length - 1];
			if (msg.params[0] === "BOUNCER" && msg.params[2] === "BIND") {
				this.dispatchError(new Error("Failed to bind to bouncer network", {
					cause: new IRCError(msg),
				}));
				this.disconnect();
			}
			if (msg.params[1] === "ACCOUNT_REQUIRED") {
				this.dispatchError(new IRCError(msg));
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
			let respStr = base64.encode("\0" + params.username + "\0" + params.password);
			initialResp = { command: "AUTHENTICATE", params: [respStr] };
			break;
		case "EXTERNAL":
			initialResp = { command: "AUTHENTICATE", params: ["+"] };
			break;
		case "OAUTHBEARER":
			let raw = "n,,\x01auth=Bearer " + params.token + "\x01\x01";
			initialResp = { command: "AUTHENTICATE", params: [base64.encode(raw)] };
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
				throw new IRCError(msg);
			}
		});
		this.send(initialResp);
		return promise;
	}

	who(mask, options) {
		let params = [mask];

		let fields = "", token = "";
		if (options && this.isupport.whox()) {
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
					throw new IRCError(msg);
				}
				break;
			}
		});
	}

	supportsSASL(mech) {
		let saslCap = this.caps.available.get("sasl");
		if (saslCap === undefined) {
			return false;
		}
		return saslCap.split(",").includes(mech);
	}

	checkAccountRegistrationCap(k) {
		let v = this.caps.available.get("draft/account-registration");
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
		if (this.params.eventPlayback) {
			wantCaps.push("draft/event-playback");
		}

		let msg = this.caps.requestAvailable(wantCaps);
		if (msg) {
			this.send(msg);
		}
	}

	handleCap(msg) {
		this.caps.parse(msg);

		let subCmd = msg.params[1];
		let args = msg.params.slice(2);
		switch (subCmd) {
		case "LS":
			this.supportsCap = true;
			if (args[0] == "*") {
				break;
			}

			console.log("Available server caps:", this.caps.available);

			this.requestCaps();

			if (this.status !== Client.Status.REGISTERED) {
				if (this.caps.available.has("sasl")) {
					let promise;
					if (this.params.saslPlain) {
						promise = this.authenticate("PLAIN", this.params.saslPlain);
					} else if (this.params.saslExternal) {
						promise = this.authenticate("EXTERNAL");
					} else if (this.params.saslOauthBearer) {
						promise = this.authenticate("OAUTHBEARER", this.params.saslOauthBearer);
					}
					(promise || Promise.resolve()).catch((err) => {
						this.dispatchError(err);
						this.disconnect();
					});
				}

				if (this.caps.available.has("soju.im/bouncer-networks") && this.params.bouncerNetwork) {
					this.send({ command: "BOUNCER", params: ["BIND", this.params.bouncerNetwork] });
				}

				this.send({ command: "CAP", params: ["END"] });
			}
			break;
		case "NEW":
			console.log("Server added available caps:", args[0]);
			this.requestCaps();
			break;
		case "DEL":
			console.log("Server removed available caps:", args[0]);
			break;
		case "ACK":
			console.log("Server ack'ed caps:", args[0]);
			break;
		case "NAK":
			console.log("Server nak'ed caps:", args[0]);
			if (this.status !== Client.Status.REGISTERED) {
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

	updateCaseMapping() {
		this.cm = this.isupport.caseMapping();
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
		let chanTypes = this.isupport.chanTypes();
		return chanTypes.indexOf(name[0]) >= 0;
	}

	isNick(name) {
		// A dollar sign is used for server-wide broadcasts
		return !this.isServer(name) && !this.isChannel(name) && !name.startsWith('$');
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
		let cmd = msg.command;

		let label;
		if (this.caps.enabled.has("labeled-response")) {
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

				let isError = false;
				switch (msg.command) {
				case "FAIL":
					isError = msg.params[0] === cmd;
					break;
				case irc.ERR_UNKNOWNERROR:
				case irc.ERR_UNKNOWNCOMMAND:
				case irc.ERR_NEEDMOREPARAMS:
				case irc.RPL_TRYAGAIN:
					isError = msg.params[1] === cmd;
					break;
				}
				if (isError) {
					removeEventListeners();
					reject(new IRCError(msg));
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

	join(channel, password) {
		let params = [channel];
		if (password) {
			params.push(password);
		}
		let msg = {
			command: "JOIN",
			params: params,
		};
		return this.roundtrip(msg, (msg) => {
			switch (msg.command) {
			case irc.ERR_NOSUCHCHANNEL:
			case irc.ERR_TOOMANYCHANNELS:
			case irc.ERR_BADCHANNELKEY:
			case irc.ERR_BANNEDFROMCHAN:
			case irc.ERR_CHANNELISFULL:
			case irc.ERR_INVITEONLYCHAN:
				if (this.cm(msg.params[1]) === this.cm(channel)) {
					throw new IRCError(msg);
				}
				break;
			case "JOIN":
				if (this.isMyNick(msg.prefix.name) && this.cm(msg.params[0]) === this.cm(channel)) {
					return true;
				}
				break;
			}
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

			if (msg.command !== "BATCH") {
				return;
			}

			let enter = msg.params[0].startsWith("+");
			let name = msg.params[0].slice(1);
			if (enter && msg.params[1] === batchType) {
				batchName = name;
				return;
			}
			if (!enter && name === batchName) {
				return { ...this.batches.get(name), messages };
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

	/* Fetch one page of history before the given date. */
	async fetchHistoryBefore(target, before, limit) {
		let max = Math.min(limit, this.isupport.chatHistory());
		let params = ["BEFORE", target, "timestamp=" + before, max];
		let messages = await this.roundtripChatHistory(params);
		return { messages, more: messages.length >= max };
	}

	/* Fetch history in ascending order. */
	async fetchHistoryBetween(target, after, before, limit) {
		let max = Math.min(limit, this.isupport.chatHistory());
		let params = ["AFTER", target, "timestamp=" + after.time, max];
		let messages = await this.roundtripChatHistory(params);
		limit -= messages.length;
		if (limit <= 0) {
			throw new Error("Cannot fetch all chat history: too many messages");
		}
		if (messages.length >= max) {
			// There are still more messages to fetch
			after.time = messages[messages.length - 1].tags.time;
			return await this.fetchHistoryBetween(target, after, before, limit);
		}
		return { messages };
	}

	async fetchHistoryTargets(t1, t2) {
		let msg = {
			command: "CHATHISTORY",
			params: ["TARGETS", "timestamp=" + t1, "timestamp=" + t2, 1000],
		};
		let batch = await this.fetchBatch(msg, "draft/chathistory-targets");
		return batch.messages.map((msg) => {
			console.assert(msg.command === "CHATHISTORY" && msg.params[0] === "TARGETS");
			return {
				name: msg.params[1],
				latestMessage: msg.params[2],
			};
		});
	}

	async listBouncerNetworks() {
		let req = { command: "BOUNCER", params: ["LISTNETWORKS"] };
		let batch = await this.fetchBatch(req, "soju.im/bouncer-networks");
		let networks = new Map();
		for (let msg of batch.messages) {
			console.assert(msg.command === "BOUNCER" && msg.params[0] === "NETWORK");
			let id = msg.params[1];
			let params = irc.parseTags(msg.params[2]);
			networks.set(id, params);
		}
		return networks;
	}

	monitor(target) {
		if (this.monitored.has(target)) {
			return;
		}

		this.monitored.set(target, true);

		// TODO: add poll-based fallback when MONITOR is not supported
		if (this.monitored.size + 1 > this.isupport.monitor()) {
			return;
		}

		this.send({ command: "MONITOR", params: ["+", target] });
	}

	unmonitor(target) {
		if (!this.monitored.has(target)) {
			return;
		}

		this.monitored.delete(target);

		if (this.isupport.monitor() <= 0) {
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
			if (msg.command !== "REGISTER") {
				return;
			}
			let result = msg.params[0];
			return {
				verificationRequired: result === "VERIFICATION_REQUIRED",
				account: msg.params[1],
				message: msg.params[2],
			};
		});
	}

	verifyAccount(account, code) {
		let msg = {
			command: "VERIFY",
			params: [account, code],
		};
		return this.roundtrip(msg, (msg) => {
			if (msg.command !== "VERIFY") {
				return;
			}
			return { message: msg.params[2] };
		});
	}

	supportsReadMarker() {
		return this.caps.enabled.has("draft/read-marker");
	}

	fetchReadMarker(target) {
		this.send({
			command: "MARKREAD",
			params: [target],
		});
	}

	setReadMarker(target, t) {
		this.send({
			command: "MARKREAD",
			params: [target, "timestamp="+t],
		});
	}
}
