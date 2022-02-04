import * as irc from "../lib/irc.js";
import Client from "../lib/client.js";
import Buffer from "./buffer.js";
import BufferList from "./buffer-list.js";
import BufferHeader from "./buffer-header.js";
import MemberList from "./member-list.js";
import ConnectForm from "./connect-form.js";
import JoinForm from "./join-form.js";
import Help from "./help.js";
import NetworkForm from "./network-form.js";
import AuthForm from "./auth-form.js";
import RegisterForm from "./register-form.js";
import VerifyForm from "./verify-form.js";
import Composer from "./composer.js";
import ScrollManager from "./scroll-manager.js";
import Dialog from "./dialog.js";
import { html, Component, createRef } from "../lib/index.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { SERVER_BUFFER, BufferType, ReceiptType, ServerStatus, Unread, State, getServerName } from "../state.js";
import commands from "../commands.js";
import { setup as setupKeybindings } from "../keybindings.js";
import * as store from "../store.js";

const baseConfig = {
	server: {},
};

const configPromise = fetch("./config.json")
	.then((resp) => {
		if (resp.ok) {
			return resp.json();
		}
		if (resp.status !== 404) {
			console.error("Failed to fetch config: HTTP error:", resp.status, resp.statusText);
		}
		return {};
	})
	.catch((err) => {
		console.error("Failed to fetch config:", err);
		return {};
	})
	.then((config) => {
		return {
			...baseConfig,
			...config,
		};
	});

const CHATHISTORY_MAX_SIZE = 4000;

function isProduction() {
	// NODE_ENV is set by the Parcel build system
	try {
		return process.env.NODE_ENV === "production";
	} catch (err) {
		return false;
	}
}

function parseQueryString() {
	let query = window.location.search.substring(1);
	let params = {};
	query.split('&').forEach((s) => {
		if (!s) {
			return;
		}
		let pair = s.split('=');
		params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
	});
	return params;
}

function splitHostPort(str) {
	let host = str;
	let port = null;

	// Literal IPv6 addresses contain colons and are enclosed in square brackets
	let i = str.lastIndexOf(":");
	if (i > 0 && !str.endsWith("]")) {
		host = str.slice(0, i);
		port = parseInt(str.slice(i + 1), 10);
	}

	if (host.startsWith("[") && host.endsWith("]")) {
		host = host.slice(1, host.length - 1);
	}

	return { host, port };
}

function fillConnectParams(params) {
	let host = window.location.host || "localhost:8080";
	let proto = "wss:";
	if (window.location.protocol != "https:") {
		proto = "ws:";
	}
	let path = window.location.pathname || "/";
	if (!window.location.host) {
		path = "/";
	}

	params = { ...params };
	if (!params.url) {
		params.url = proto + "//" + host + path + "socket";
	}
	if (params.url.startsWith("/")) {
		params.url = proto + "//" + host + params.url;
	}
	if (params.url.indexOf("://") < 0) {
		params.url = proto + "//" + params.url;
	}
	if (!params.username) {
		params.username = params.nick;
	}
	if (!params.realname) {
		params.realname = params.nick;
	}
	return params;
}

function debounce(f, delay) {
	let timeout = null;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			timeout = null;
			f(...args);
		}, delay);
	};
}

function showNotification(title, options) {
	if (!window.Notification || Notification.permission !== "granted") {
		return new EventTarget();
	}

	// This can still fail due to:
	// https://bugs.chromium.org/p/chromium/issues/detail?id=481856
	try {
		return new Notification(title, options);
	} catch (err) {
		console.error("Failed to show notification: ", err);
		return new EventTarget();
	}
}

let lastErrorID = 0;

export default class App extends Component {
	state = {
		...State.create(),
		connectParams: {
			url: null,
			pass: null,
			username: null,
			realname: null,
			nick: null,
			saslPlain: null,
			saslExternal: false,
			autoconnect: false,
			autojoin: [],
			ping: 0,
		},
		connectForm: true,
		loading: true,
		dialog: null,
		dialogData: null,
		error: null,
		openPanels: {
			bufferList: false,
			memberList: false,
		},
	};
	debug = !isProduction();
	config = { ...baseConfig };
	clients = new Map();
	endOfHistory = new Map();
	receipts = new Map();
	buffer = createRef();
	composer = createRef();
	switchToChannel = null;
	/**
	 * Parsed irc:// URL to automatically open. The user will be prompted for
	 * confirmation for security reasons.
	 */
	autoOpenURL = null;

	constructor(props) {
		super(props);

		this.handleConnectSubmit = this.handleConnectSubmit.bind(this);
		this.handleJoinSubmit = this.handleJoinSubmit.bind(this);
		this.handleBufferListClick = this.handleBufferListClick.bind(this);
		this.handleBufferListClose = this.handleBufferListClose.bind(this);
		this.toggleBufferList = this.toggleBufferList.bind(this);
		this.toggleMemberList = this.toggleMemberList.bind(this);
		this.handleComposerSubmit = this.handleComposerSubmit.bind(this);
		this.handleChannelClick = this.handleChannelClick.bind(this);
		this.handleNickClick = this.handleNickClick.bind(this);
		this.autocomplete = this.autocomplete.bind(this);
		this.handleBufferScrollTop = this.handleBufferScrollTop.bind(this);
		this.dismissDialog = this.dismissDialog.bind(this);
		this.handleAddNetworkClick = this.handleAddNetworkClick.bind(this);
		this.handleNetworkSubmit = this.handleNetworkSubmit.bind(this);
		this.handleNetworkRemove = this.handleNetworkRemove.bind(this);
		this.handleDismissError = this.handleDismissError.bind(this);
		this.handleAuthSubmit = this.handleAuthSubmit.bind(this);
		this.handleRegisterSubmit = this.handleRegisterSubmit.bind(this);
		this.handleVerifyClick = this.handleVerifyClick.bind(this);
		this.handleVerifySubmit = this.handleVerifySubmit.bind(this);

		this.saveReceipts = debounce(this.saveReceipts.bind(this), 500);

		this.receipts = store.receipts.load();
		this.bufferStore = new store.Buffer();

		configPromise.then((config) => {
			this.handleConfig(config);
			return config;
		});
	}

	/**
	 * Handle configuration data and populate the connection parameters.
	 *
	 * The priority order is:
	 *
	 * - URL params
	 * - Saved parameters in local storage
	 * - Configuration data (fetched from the config.json file)
	 * - Default server URL constructed from the current URL location (this is
	 *   done in fillConnectParams)
	 */
	handleConfig(config) {
		this.setState({ loading: false });

		let connectParams = { ...this.state.connectParams };

		if (config.server) {
			if (typeof config.server.url === "string") {
				connectParams.url = config.server.url;
			}
			if (Array.isArray(config.server.autojoin)) {
				connectParams.autojoin = config.server.autojoin;
			} else if (typeof config.server.autojoin === "string") {
				connectParams.autojoin = [config.server.autojoin];
			}
			if (typeof config.server.nick === "string") {
				connectParams.nick = config.server.nick;
			}
			if (typeof config.server.autoconnect === "boolean") {
				connectParams.autoconnect = config.server.autoconnect;
			}
			if (config.server.auth === "external") {
				connectParams.saslExternal = true;
			}
			if (typeof config.server.ping === "number") {
				connectParams.ping = config.server.ping;
			}
		}

		let autoconnect = store.autoconnect.load();
		if (autoconnect) {
			connectParams = {
				...connectParams,
				...autoconnect,
				autoconnect: true,
				autojoin: [], // handled by store.Buffer
			};
		}

		let autojoin = [];

		let queryParams = parseQueryString();
		// Don't allow to silently override the server URL if there's one in
		// config.json, because this has security implications. But still allow
		// setting server to an empty string to reveal the server field in the
		// connect form.
		if (typeof queryParams.server === "string" && (!connectParams.url || !queryParams.server)) {
			connectParams.url = queryParams.server;

			// When using a custom server, some configuration options don't
			// make sense anymore.
			config.server.auth = null;
		}
		if (typeof queryParams.nick === "string") {
			connectParams.nick = queryParams.nick;
		}
		if (typeof queryParams.channels === "string") {
			autojoin = queryParams.channels.split(",");
		}
		if (typeof queryParams.open === "string") {
			this.autoOpenURL = irc.parseURL(queryParams.open);
		}
		if (queryParams.debug === "1") {
			this.debug = true;
		}

		if (window.location.hash) {
			autojoin = window.location.hash.split(",");
		}

		this.config = config;

		if (autojoin.length > 0) {
			if (connectParams.autoconnect) {
				// Ask the user whether they want to join that new channel.
				// TODO: support multiple channels here
				this.autoOpenURL = { host: "", entity: autojoin[0] };
			} else {
				connectParams.autojoin = autojoin;
			}
		}

		this.setState({ connectParams: connectParams });

		if (connectParams.autoconnect) {
			this.setState({ connectForm: false });
			this.connect(connectParams);
		}
	}

	showError(err) {
		console.error("App error: ", err);

		let text;
		if (err instanceof Error) {
			let l = [];
			while (err) {
				l.push(err.message);
				err = err.cause;
			}
			text = l.join(": ");
		} else {
			text = String(err);
		}
		this.setState({ error: text });
		lastErrorID++;
		return lastErrorID;
	}

	dismissError(id) {
		if (id && id !== lastErrorID) {
			return;
		}
		this.setState({ error: null });
	}

	handleDismissError(event) {
		event.preventDefault();
		this.dismissError();
	}

	setServerState(id, updater, callback) {
		this.setState((state) => {
			return State.updateServer(state, id, updater);
		}, callback);
	}

	setBufferState(id, updater, callback) {
		this.setState((state) => {
			return State.updateBuffer(state, id, updater);
		}, callback);
	}

	syncBufferUnread(serverID, name) {
		let client = this.clients.get(serverID);

		let stored = this.bufferStore.get({ name, server: client.params });
		if (client.caps.enabled.has("draft/chathistory") && stored) {
			this.setBufferState({ server: serverID, name }, { unread: stored.unread });
		}
		if (!stored) {
			this.bufferStore.put({
				name,
				server: client.params,
				unread: Unread.NONE,
			});
		}
	}

	createBuffer(serverID, name) {
		let client = this.clients.get(serverID);
		let id = null;
		let isNew = false;
		this.setState((state) => {
			let updated;
			[id, updated] = State.createBuffer(state, name, serverID, client);
			isNew = !!updated;
			return updated;
		});
		if (isNew) {
			this.syncBufferUnread(serverID, name);
		}
		return id;
	}

	switchBuffer(id) {
		let buf;
		this.setState((state) => {
			buf = State.getBuffer(state, id);
			if (!buf) {
				return;
			}
			return { activeBuffer: buf.id };
		}, () => {
			if (!buf) {
				return;
			}

			let prevReadReceipt = this.getReceipt(buf.name, ReceiptType.READ);
			// TODO: only mark as read if user scrolled at the bottom
			this.setBufferState(buf.id, {
				unread: Unread.NONE,
				prevReadReceipt,
			});

			if (this.buffer.current) {
				this.buffer.current.focus();
			}

			if (buf.messages.length > 0) {
				let lastMsg = buf.messages[buf.messages.length - 1];
				this.setReceipt(buf.name, ReceiptType.READ, lastMsg);

				let client = this.clients.get(buf.server);
				this.bufferStore.put({
					name: buf.name,
					server: client.params,
					unread: Unread.NONE,
				});
			}

			let server = this.state.servers.get(buf.server);
			if (buf.type === BufferType.NICK && !server.users.has(buf.name)) {
				this.whoUserBuffer(buf.name, buf.server);
			}
		});
	}

	saveReceipts() {
		store.receipts.put(this.receipts);
	}

	getReceipt(target, type) {
		let receipts = this.receipts.get(target);
		if (!receipts) {
			return undefined;
		}
		return receipts[type];
	}

	hasReceipt(target, type, msg) {
		let receipt = this.getReceipt(target, type);
		return receipt && msg.tags.time <= receipt.time;
	}

	setReceipt(target, type, msg) {
		let receipt = this.getReceipt(target, type);
		if (this.hasReceipt(target, type, msg)) {
			return;
		}
		// TODO: this doesn't trigger a redraw
		this.receipts.set(target, {
			...this.receipts.get(target),
			[type]: { time: msg.tags.time },
		});
		this.saveReceipts();
	}

	latestReceipt(type) {
		let last = null;
		this.receipts.forEach((receipts, target) => {
			if (target === "*") {
				return;
			}
			let delivery = receipts[type];
			if (!delivery || !delivery.time) {
				return;
			}
			if (!last || delivery.time > last.time) {
				last = delivery;
			}
		});
		return last;
	}

	addMessage(serverID, bufName, msg) {
		let client = this.clients.get(serverID);

		// Treat server-wide broadcasts as highlights. They're sent by server
		// operators and can contain important information.
		msg.isHighlight = irc.isHighlight(msg, client.nick, client.cm) || irc.isServerBroadcast(msg);

		if (!msg.tags) {
			msg.tags = {};
		}
		if (!msg.tags.time) {
			msg.tags.time = irc.formatDate(new Date());
		}

		let isDelivered = this.hasReceipt(bufName, ReceiptType.DELIVERED, msg);
		let isRead = this.hasReceipt(bufName, ReceiptType.READ, msg);
		// TODO: messages coming from infinite scroll shouldn't trigger notifications

		if (client.isMyNick(msg.prefix.name)) {
			isRead = true;
		}

		let msgUnread = Unread.NONE;
		if ((msg.command == "PRIVMSG" || msg.command == "NOTICE") && !isRead) {
			let target = msg.params[0];
			let text = msg.params[1];

			let kind;
			if (msg.isHighlight) {
				msgUnread = Unread.HIGHLIGHT;
				kind = "highlight";
			} else if (client.isMyNick(target)) {
				msgUnread = Unread.HIGHLIGHT;
				kind = "private message";
			} else {
				msgUnread = Unread.MESSAGE;
			}

			if (msgUnread == Unread.HIGHLIGHT && !isDelivered && !irc.parseCTCP(msg)) {
				let title = "New " + kind + " from " + msg.prefix.name;
				if (client.isChannel(bufName)) {
					title += " in " + bufName;
				}
				let notif = showNotification(title, {
					body: stripANSI(text),
					requireInteraction: true,
					tag: "msg," + msg.prefix.name + "," + bufName,
				});
				notif.addEventListener("click", () => {
					// TODO: scroll to message
					this.switchBuffer({ server: serverID, name: bufName });
				});
			}
		}
		if (msg.command === "INVITE" && client.isMyNick(msg.params[0])) {
			msgUnread = Unread.HIGHLIGHT;

			let channel = msg.params[1];
			let notif = new Notification("Invitation to " + channel, {
				body: msg.prefix.name + " has invited you to " + channel,
				requireInteraction: true,
				tag: "invite," + msg.prefix.name + "," + channel,
				actions: [{
					action: "accept",
					title: "Accept",
				}],
			});
			notif.addEventListener("click", (event) => {
				if (event.action === "accept") {
					this.setReceipt(bufName, ReceiptType.READ, msg);
					this.open(channel, serverID);
				} else {
					// TODO: scroll to message
					this.switchBuffer({ server: serverID, name: bufName });
				}
			});
		}

		// Open a new buffer if the message doesn't come from me or is a
		// self-message
		if ((!client.isMyNick(msg.prefix.name) || client.isMyNick(bufName)) && (msg.command != "PART" && msg.comand != "QUIT")) {
			this.createBuffer(serverID, bufName);
		}

		this.setReceipt(bufName, ReceiptType.DELIVERED, msg);

		let bufID = { server: serverID, name: bufName };
		this.setState((state) => State.addMessage(state, msg, bufID));
		this.setBufferState(bufID, (buf) => {
			// TODO: set unread if scrolled up
			let unread = buf.unread;
			let prevReadReceipt = buf.prevReadReceipt;

			if (this.state.activeBuffer !== buf.id) {
				unread = Unread.union(unread, msgUnread);
			} else {
				this.setReceipt(bufName, ReceiptType.READ, msg);
			}

			// Don't show unread marker for my own messages
			if (client.isMyNick(msg.prefix.name)) {
				prevReadReceipt = { time: msg.tags.time };
			}

			this.bufferStore.put({
				name: buf.name,
				server: client.params,
				unread,
			});
			return { unread, prevReadReceipt };
		});
	}

	connect(params) {
		let serverID = null;
		this.setState((state) => {
			let update;
			[serverID, update] = State.createServer(state);
			return update;
		});
		this.setState({ connectParams: params });

		let client = new Client(fillConnectParams(params));
		client.debug = this.debug;

		this.clients.set(serverID, client);
		this.setServerState(serverID, { status: client.status });

		let errorID = null;

		client.addEventListener("status", () => {
			this.setServerState(serverID, { status: client.status });
			switch (client.status) {
			case Client.Status.DISCONNECTED:
				this.setServerState(serverID, { account: null });
				this.setState((state) => {
					let buffers = new Map(state.buffers);
					state.buffers.forEach((buf) => {
						if (buf.server !== serverID) {
							return;
						}
						buffers.set(buf.id, { ...buf, joined: false });
					});
					return { buffers };
				});
				break;
			case Client.Status.REGISTERED:
				this.setState({ connectForm: false });
				if (errorID) {
					this.dismissError(errorID);
				}
				break;
			}
		});

		client.addEventListener("message", (event) => {
			this.handleMessage(serverID, event.detail.message);
		});

		client.addEventListener("error", (event) => {
			errorID = this.showError(event.detail);
		});

		this.createBuffer(serverID, SERVER_BUFFER);
		if (!this.state.activeBuffer) {
			this.switchBuffer({ server: serverID, name: SERVER_BUFFER });
		}

		if (params.autojoin.length > 0) {
			this.switchToChannel = params.autojoin[0];
		}
	}

	disconnect(serverID) {
		if (!serverID) {
			serverID = State.getActiveServerID(this.state);
		}

		let client = this.clients.get(serverID);
		if (client) {
			this.clients.delete(serverID);
			client.disconnect();
		}
	}

	reconnect(serverID) {
		if (!serverID) {
			serverID = State.getActiveServerID(this.state);
		}

		let client = this.clients.get(serverID);
		if (client) {
			client.reconnect();
		}
	}

	serverFromBouncerNetwork(bouncerNetworkID) {
		for (let [id, client] of this.clients) {
			if (client.params.bouncerNetwork === bouncerNetworkID) {
				return id;
			}
		}
		return null;
	}

	routeMessage(serverID, msg) {
		let client = this.clients.get(serverID);
		let chatHistoryBatch = irc.findBatchByType(msg, "chathistory");

		let target, channel, affectedBuffers;
		switch (msg.command) {
		case "MODE":
			target = msg.params[0];
			if (client.isChannel(target)) {
				return [target];
			}
			return [SERVER_BUFFER];
		case "NOTICE":
		case "PRIVMSG":
			target = msg.params[0];
			if (client.isMyNick(target)) {
				if (client.cm(msg.prefix.name) === client.cm(client.serverPrefix.name)) {
					target = SERVER_BUFFER;
				} else {
					target = msg.prefix.name;
				}
			}
			if (msg.command === "NOTICE" && !State.getBuffer(this.state, { server: serverID, name: target })) {
				// Don't open a new buffer if this is just a NOTICE
				target = SERVER_BUFFER;
			}

			let allowedPrefixes = client.isupport.statusMsg();
			if (allowedPrefixes) {
				let parts = irc.parseTargetPrefix(target, allowedPrefixes);
				if (client.isChannel(parts.name)) {
					target = parts.name;
				}
			}
			return [target];
		case "JOIN":
			channel = msg.params[0];
			if (!client.isMyNick(msg.prefix.name)) {
				return [channel];
			}
			return [];
		case "PART":
			channel = msg.params[0];
			return [channel];
		case "KICK":
			channel = msg.params[0];
			return [channel];
		case "QUIT":
			affectedBuffers = [];
			if (chatHistoryBatch) {
				affectedBuffers.push(chatHistoryBatch.params[0]);
			} else {
				this.state.buffers.forEach((buf) => {
					if (buf.server != serverID) {
						return;
					}
					if (!buf.members.has(msg.prefix.name) && client.cm(buf.name) !== client.cm(msg.prefix.name)) {
						return;
					}
					affectedBuffers.push(buf.name);
				});
			}
			return affectedBuffers;
		case "NICK":
			let newNick = msg.params[0];

			affectedBuffers = [];
			if (chatHistoryBatch) {
				affectedBuffers.push(chatHistoryBatch.params[0]);
			} else {
				this.state.buffers.forEach((buf) => {
					if (buf.server != serverID) {
						return;
					}
					if (!buf.members.has(msg.prefix.name)) {
						return;
					}
					affectedBuffers.push(buf.name);
				});
				if (client.isMyNick(newNick)) {
					affectedBuffers.push(SERVER_BUFFER);
				}
			}
			return affectedBuffers;
		case "TOPIC":
			channel = msg.params[0];
			return [channel];
		case "INVITE":
			channel = msg.params[1];

			// TODO: find a more reliable way to do this
			let bufName = channel;
			if (!State.getBuffer(this.state, { server: serverID, name: channel })) {
				bufName = SERVER_BUFFER;
			}

			return [bufName];
		case irc.RPL_CHANNELMODEIS:
		case irc.RPL_CREATIONTIME:
		case irc.RPL_INVITELIST:
		case irc.RPL_ENDOFINVITELIST:
		case irc.RPL_EXCEPTLIST:
		case irc.RPL_ENDOFEXCEPTLIST:
		case irc.RPL_BANLIST:
		case irc.RPL_ENDOFBANLIST:
		case irc.RPL_QUIETLIST:
		case irc.RPL_ENDOFQUIETLIST:
			channel = msg.params[1];
			return [channel];
		case irc.RPL_INVITING:
			channel = msg.params[2];
			return [channel];
		case irc.RPL_YOURHOST:
		case irc.RPL_MYINFO:
		case irc.RPL_ISUPPORT:
		case irc.RPL_ENDOFMOTD:
		case irc.ERR_NOMOTD:
		case irc.RPL_AWAY:
		case irc.RPL_NOTOPIC:
		case irc.RPL_TOPIC:
		case irc.RPL_TOPICWHOTIME:
		case irc.RPL_NAMREPLY:
		case irc.RPL_ENDOFNAMES:
		case irc.RPL_MONONLINE:
		case irc.RPL_MONOFFLINE:
		case irc.RPL_SASLSUCCESS:
		case "AWAY":
		case "SETNAME":
		case "CHGHOST":
		case "ACCOUNT":
		case "CAP":
		case "AUTHENTICATE":
		case "PING":
		case "PONG":
		case "BATCH":
		case "TAGMSG":
		case "CHATHISTORY":
		case "ACK":
		case "BOUNCER":
			// Ignore these
			return [];
		default:
			return [SERVER_BUFFER];
		}
	}

	handleMessage(serverID, msg) {
		let client = this.clients.get(serverID);

		let destBuffers = this.routeMessage(serverID, msg);

		if (irc.findBatchByType(msg, "chathistory")) {
			destBuffers.forEach((bufName) => {
				this.addMessage(serverID, bufName, msg);
			});
			return;
		}

		this.setState((state) => State.handleMessage(state, msg, serverID, client));

		let target, channel;
		switch (msg.command) {
		case irc.RPL_WELCOME:
			let lastReceipt = this.latestReceipt(ReceiptType.DELIVERED);
			if (lastReceipt && lastReceipt.time && client.caps.enabled.has("draft/chathistory") && (!client.caps.enabled.has("soju.im/bouncer-networks") || client.params.bouncerNetwork)) {
				let now = irc.formatDate(new Date());
				client.fetchHistoryTargets(now, lastReceipt.time).then((targets) => {
					targets.forEach((target) => {
						let from = lastReceipt;
						let to = { time: msg.tags.time || now };
						this.fetchBacklog(client, target.name, from, to);
					});
				});
			}
			break;
		case irc.RPL_ENDOFMOTD:
		case irc.ERR_NOMOTD:
			// These messages are used to indicate the end of the ISUPPORT list

			// Restore opened channel and user buffers
			let join = [];
			for (let buf of this.bufferStore.list(client.params)) {
				if (buf.name === "*") {
					continue;
				}

				if (client.isChannel(buf.name)) {
					if (client.caps.enabled.has("soju.im/bouncer-networks")) {
						continue;
					}
					join.push(buf.name);
				} else {
					this.createBuffer(serverID, buf.name);
					this.whoUserBuffer(buf.name, serverID);
				}
			}

			// Auto-join channels given at connect-time
			let server = this.state.servers.get(serverID);
			let bouncerNetID = server.bouncerNetID;
			let bouncerNetwork = null;
			if (bouncerNetID) {
				bouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
			}
			if (!bouncerNetwork || bouncerNetwork.state === "connected") {
				join = join.concat(client.params.autojoin);
				client.params.autojoin = [];
			}

			if (join.length > 0) {
				client.send({
					command: "JOIN",
					params: [join.join(",")],
				});
			}

			let serverHost = bouncerNetwork ? bouncerNetwork.host : "";
			if (this.autoOpenURL && serverHost === this.autoOpenURL.host) {
				this.openURL(this.autoOpenURL);
				this.autoOpenURL = null;
			}
		case "JOIN":
			channel = msg.params[0];

			if (client.isMyNick(msg.prefix.name)) {
				this.syncBufferUnread(serverID, channel);
			}
			if (channel == this.switchToChannel) {
				this.switchBuffer({ server: serverID, name: channel });
				this.switchToChannel = null;
			}
			break;
		case "PART":
			channel = msg.params[0];

			if (client.isMyNick(msg.prefix.name)) {
				this.receipts.delete(channel);
				this.saveReceipts();
			}
			break;
		case "BOUNCER":
			if (msg.params[0] !== "NETWORK") {
				break; // We're only interested in network updates
			}

			if (client.isupport.bouncerNetID()) {
				// This can happen if the user has specified a network to bind
				// to via other means, e.g. "<username>/<network>".
				break;
			}

			let id = msg.params[1];
			let attrs = null;
			if (msg.params[2] !== "*") {
				attrs = irc.parseTags(msg.params[2]);
			}

			let isNew = false;
			this.setState((state) => {
				if (!attrs) {
					return State.deleteBouncerNetwork(state, id);
				} else {
					isNew = !state.bouncerNetworks.has(id);
					return State.storeBouncerNetwork(state, id, attrs);
				}
			}, () => {
				if (!attrs) {
					let serverID = this.serverFromBouncerNetwork(id);
					if (serverID) {
						this.close({ server: serverID, name: SERVER_BUFFER });
					}
				} else if (isNew) {
					this.connect({
						...client.params,
						bouncerNetwork: id,
					});
				}

				if (attrs && attrs.state === "connected") {
					let serverID = this.serverFromBouncerNetwork(id);
					let client = this.clients.get(serverID);
					if (client && client.status === Client.Status.REGISTERED && client.params.autojoin && client.params.autojoin.length > 0) {
						client.send({
							command: "JOIN",
							params: [client.params.autojoin.join(",")],
						});
						client.params.autojoin = [];
					}
				}
			});
			break;
		case "BATCH":
			if (!msg.params[0].startsWith("-")) {
				break;
			}
			let name = msg.params[0].slice(1);
			let batch = client.batches.get(name);
			if (!batch || batch.type !== "soju.im/bouncer-networks") {
				break;
			}

			// We've received a BOUNCER NETWORK batch. If we have a URL to
			// auto-open and no existing network matches it, ask the user to
			// create a new network.
			if (this.autoOpenURL && this.autoOpenURL.host && !this.findBouncerNetIDByHost(this.autoOpenURL.host)) {
				this.openURL(this.autoOpenURL);
				this.autoOpenURL = null;
			}
			break;
		default:
			if (irc.isError(msg.command) && msg.command != irc.ERR_NOMOTD) {
				let description = msg.params[msg.params.length - 1];
				this.showError(description);
			}
		}

		destBuffers.forEach((bufName) => {
			this.addMessage(serverID, bufName, msg);
		});
	}

	handleConnectSubmit(connectParams) {
		this.dismissError();

		if (connectParams.autoconnect) {
			store.autoconnect.put(connectParams);
		} else {
			store.autoconnect.put(null);
		}

		// Disconnect previous server, if any
		let activeBuffer = this.state.buffers.get(this.state.activeBuffer);
		if (activeBuffer) {
			this.close(activeBuffer.server);
		}

		this.connect(connectParams);
	}

	handleChannelClick(event) {
		let handled = this.openURL(event.target.href);
		if (handled) {
			event.preventDefault();
		}
	}

	findBouncerNetIDByHost(host) {
		for (let [id, bouncerNetwork] of this.state.bouncerNetworks) {
			if (bouncerNetwork.host === host) {
				return id;
			}
		}
		return null;
	}

	openURL(url) {
		if (typeof url === "string") {
			url = irc.parseURL(url);
		}
		if (!url) {
			return false;
		}

		let { host, port } = splitHostPort(url.host);

		let serverID;
		if (!url.host) {
			serverID = State.getActiveServerID(this.state);
		} else {
			let bouncerNetID = this.findBouncerNetIDByHost(host);
			if (!bouncerNetID) {
				// Open dialog to create network if bouncer
				let client = this.clients.values().next().value;
				if (!client || !client.caps.enabled.has("soju.im/bouncer-networks")) {
					return false;
				}

				let params = { host };
				if (typeof port === "number") {
					params.port = port;
				}
				this.openDialog("network", { params, autojoin: url.entity });
				return true;
			}

			for (let [id, server] of this.state.servers) {
				if (server.bouncerNetID === bouncerNetID) {
					serverID = id;
					break;
				}
			}
		}
		if (!serverID) {
			return false;
		}

		let buf = State.getBuffer(this.state, { server: serverID, name: url.entity || SERVER_BUFFER });
		if (buf) {
			this.switchBuffer(buf.id);
		} else {
			this.openDialog("join", { server: serverID, channel: url.entity });
		}
		return true;
	}

	handleNickClick(nick) {
		this.open(nick);
	}

	fetchBacklog(client, target, after, before) {
		client.fetchHistoryBetween(target, after, before, CHATHISTORY_MAX_SIZE).catch((err) => {
			console.error("Failed to fetch backlog for '" + target + "': ", err);
			this.showError("Failed to fetch backlog for '" + target + "'");
			this.receipts.delete(target);
			this.saveReceipts();
		});
	}

	whoUserBuffer(target, serverID) {
		let client = this.clients.get(serverID);

		client.who(target, {
			fields: ["flags", "hostname", "nick", "realname", "username", "account"],
		});
		client.monitor(target);
	}

	open(target, serverID, password) {
		if (!serverID) {
			serverID = State.getActiveServerID(this.state);
		}

		let client = this.clients.get(serverID);
		if (client.isServer(target)) {
			this.switchBuffer({ server: serverID });
		} else if (client.isChannel(target)) {
			this.switchToChannel = target;
			client.join(target, password).catch((err) => {
				this.showError(err);
			});
		} else {
			this.whoUserBuffer(target, serverID);
			this.createBuffer(serverID, target);
			this.switchBuffer({ server: serverID, name: target });
		}
	}

	close(id) {
		let buf = State.getBuffer(this.state, id);
		if (!buf) {
			return;
		}

		let client = this.clients.get(buf.server);
		switch (buf.type) {
		case BufferType.SERVER:
			this.setState((state) => {
				let buffers = new Map(state.buffers);
				for (let [id, b] of state.buffers) {
					if (b.server === buf.server) {
						buffers.delete(id);
					}
				}

				let activeBuffer = state.activeBuffer;
				if (activeBuffer && state.buffers.get(activeBuffer).server === buf.server) {
					if (buffers.size > 0) {
						activeBuffer = buffers.keys().next().value;
					} else {
						activeBuffer = null;
					}
				}

				return { buffers, activeBuffer };
			});

			let disconnectAll = client && !client.params.bouncerNetwork && client.caps.enabled.has("soju.im/bouncer-networks");

			this.disconnect(buf.server);

			this.setState((state) => {
				let servers = new Map(state.servers);
				servers.delete(buf.server);

				let connectForm = state.connectForm;
				if (servers.size == 0) {
					connectForm = true;
				}

				return { servers, connectForm };
			});

			if (disconnectAll) {
				for (let serverID of this.clients.keys()) {
					this.close({ server: serverID, name: SERVER_BUFFER });
				}
				this.bufferStore.clear();
			} else {
				this.bufferStore.clear(client.params);
			}

			// TODO: only clear autoconnect if this server is stored there
			if (buf.server == 1) {
				store.autoconnect.put(null);
			}
			break;
		case BufferType.CHANNEL:
			if (buf.joined) {
				client.send({ command: "PART", params: [buf.name] });
			}
			// fallthrough
		case BufferType.NICK:
			this.switchBuffer({ name: SERVER_BUFFER });
			this.setState((state) => {
				let buffers = new Map(state.buffers);
				buffers.delete(buf.id);
				return { buffers };
			});

			client.unmonitor(buf.name);

			this.receipts.delete(buf.name);
			this.saveReceipts();

			this.bufferStore.delete({ name: buf.name, server: client.params });
			break;
		}
	}

	executeCommand(s) {
		let parts = s.split(" ");
		let name = parts[0].toLowerCase().slice(1);
		let args = parts.slice(1);

		let cmd = commands[name];
		if (!cmd) {
			this.showError(`Unknown command "${name}" (run "/help" to get a command list)`);
			return;
		}

		try {
			cmd.execute(this, args);
		} catch (error) {
			console.error(`Failed to execute command "${name}":`, error);
			this.showError(error.message);
		}
	}

	privmsg(target, text) {
		if (target == SERVER_BUFFER) {
			this.showError("Cannot send message in server buffer");
			return;
		}

		let serverID = State.getActiveServerID(this.state);
		let client = this.clients.get(serverID);

		let msg = { command: "PRIVMSG", params: [target, text] };
		client.send(msg);

		if (!client.caps.enabled.has("echo-message")) {
			msg.prefix = { name: client.nick };
			this.addMessage(serverID, target, msg);
		}
	}

	handleComposerSubmit(text) {
		if (!text) {
			return;
		}

		if (text.startsWith("//")) {
			text = text.slice(1);
		} else if (text.startsWith("/")) {
			this.executeCommand(text);
			return;
		}

		let buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf) {
			return;
		}

		this.privmsg(buf.name, text);
	}

	handleBufferListClick(id) {
		this.switchBuffer(id);
		this.closeBufferList();
	}

	handleBufferListClose(id) {
		this.close(id);
		this.closeBufferList();
	}

	toggleBufferList() {
		this.setState((state) => {
			let openPanels = {
				...state.openPanels,
				bufferList: !state.openPanels.bufferList,
			};
			return { openPanels };
		});
	}

	toggleMemberList() {
		this.setState((state) => {
			let openPanels = {
				...state.openPanels,
				memberList: !state.openPanels.memberList,
			};
			return { openPanels };
		});
	}

	closeBufferList() {
		this.setState((state) => {
			let openPanels = {
				...state.openPanels,
				bufferList: false,
			};
			return { openPanels };
		});
	}

	closeMemberList() {
		this.setState((state) => {
			let openPanels = {
				...state.openPanels,
				memberList: false,
			};
			return { openPanels };
		});
	}

	handleJoinClick(buf) {
		switch (buf.type) {
		case BufferType.SERVER:
			this.openDialog("join", { server: buf.server });
			break;
		case BufferType.CHANNEL:
			let client = this.clients.get(buf.server);
			client.send({ command: "JOIN", params: [buf.name] });
			break;
		}
	}

	handleJoinSubmit(data) {
		this.open(data.channel, this.state.dialogData.server);
		this.dismissDialog();
	}

	autocomplete(prefix) {
		function fromList(l, prefix) {
			prefix = prefix.toLowerCase();
			let repl = [];
			for (let item of l) {
				if (item.toLowerCase().startsWith(prefix)) {
					repl.push(item);
				}
			}
			return repl;
		}

		if (prefix.startsWith("/")) {
			let repl = fromList(Object.keys(commands), prefix.slice(1));
			return repl.map(cmd => "/" + cmd);
		}

		// TODO: consider using the CHANTYPES ISUPPORT token here
		if (prefix.startsWith("#")) {
			let chanNames = [];
			for (const buf of this.state.buffers.values()) {
				if (buf.name.startsWith("#")) {
					chanNames.push(buf.name);
				}
			}
			return fromList(chanNames, prefix);
		}

		let buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf || !buf.members) {
			return [];
		}
		return fromList(buf.members.keys(), prefix);
	}

	openHelp() {
		this.openDialog("help");
	}

	handleBufferScrollTop() {
		let buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf || buf.type == BufferType.SERVER) {
			return;
		}

		let client = this.clients.get(buf.server);

		if (!client || !client.caps.enabled.has("draft/chathistory") || !client.caps.enabled.has("server-time")) {
			return;
		}
		if (this.endOfHistory.get(buf.id)) {
			return;
		}

		let before;
		if (buf.messages.length > 0) {
			before = buf.messages[0].tags["time"];
		} else {
			before = irc.formatDate(new Date());
		}

		// Avoids sending multiple CHATHISTORY commands in parallel
		this.endOfHistory.set(buf.id, true);

		let limit = 100;
		if (client.caps.enabled.has("draft/event-playback")) {
			limit = 200;
		}

		client.fetchHistoryBefore(buf.name, before, limit).then((result) => {
			this.endOfHistory.set(buf.id, !result.more);
		});
	}

	openDialog(name, data) {
		this.setState({ dialog: name, dialogData: data });
	}

	dismissDialog() {
		this.setState({ dialog: null, dialogData: null });
	}

	setDialogLoading(promise) {
		const setLoading = (loading) => {
			this.setState((state) => {
				return { dialogData: { ...state.dialogData, loading } };
			});
		};

		setLoading(true);
		promise.finally(() => setLoading(false));
	}

	handleAuthClick(serverID) {
		let client = this.clients.get(serverID);
		this.openDialog("auth", { username: client.nick });
	}

	handleAuthSubmit(username, password) {
		let serverID = State.getActiveServerID(this.state);
		let client = this.clients.get(serverID);
		let promise = client.authenticate("PLAIN", { username, password }).then(() => {
			this.dismissDialog();

			let firstClient = this.clients.values().next().value;
			if (client !== firstClient) {
				return;
			}

			let autoconnect = store.autoconnect.load();
			if (!autoconnect) {
				return;
			}

			console.log("Saving SASL PLAIN credentials");
			autoconnect = {
				...autoconnect,
				saslPlain: { username, password },
			};
			store.autoconnect.put(autoconnect);
		});
		this.setDialogLoading(promise);
	}

	handleRegisterClick(serverID) {
		let client = this.clients.get(serverID);
		let emailRequired = client.checkAccountRegistrationCap("email-required");
		this.openDialog("register", { emailRequired });
	}

	handleRegisterSubmit(email, password) {
		let serverID = State.getActiveServerID(this.state);
		let client = this.clients.get(serverID);
		// TODO: show registration status (pending/error) in dialog
		let promise = client.registerAccount(email, password).then((data) => {
			this.dismissDialog();

			if (data.verificationRequired) {
				this.handleVerifyClick(data.account, data.message);
			}

			let firstClient = this.clients.values().next().value;
			if (client !== firstClient) {
				return;
			}

			let autoconnect = store.autoconnect.load();
			if (!autoconnect) {
				return;
			}

			console.log("Saving account registration credentials");
			autoconnect = {
				...autoconnect,
				saslPlain: { username: data.account, password },
			};
			store.autoconnect.put(autoconnect);
		});
		this.setDialogLoading(promise);
	}

	handleVerifyClick(account, message) {
		this.openDialog("verify", { account, message });
	}

	handleVerifySubmit(code) {
		let serverID = State.getActiveServerID(this.state);
		let client = this.clients.get(serverID);
		// TODO: display verification status (pending/error) in dialog
		let promise = client.verifyAccount(this.state.dialogData.account, code).then(() => {
			this.dismissDialog();
		});
		this.setDialogLoading(promise);
	}

	handleAddNetworkClick() {
		this.openDialog("network");
	}

	handleManageNetworkClick(serverID) {
		let server = this.state.servers.get(serverID);
		let bouncerNetID = server.bouncerNetID;
		let bouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
		this.openDialog("network", {
			id: bouncerNetID,
			params: bouncerNetwork,
		});
	}

	handleNetworkSubmit(attrs, autojoin) {
		let client = this.clients.values().next().value;

		if (this.state.dialogData && this.state.dialogData.id) {
			if (Object.keys(attrs).length == 0) {
				this.dismissDialog();
				return;
			}

			client.send({
				command: "BOUNCER",
				params: ["CHANGENETWORK", this.state.dialogData.id, irc.formatTags(attrs)],
			});
		} else {
			attrs = { ...attrs, tls: "1" };
			client.createBouncerNetwork(attrs).then((id) => {
				if (!autojoin) {
					return;
				}

				// By this point, bouncer-networks-notify should've advertised
				// the new network
				let serverID = this.serverFromBouncerNetwork(id);
				let client = this.clients.get(serverID);
				client.params.autojoin = [autojoin];

				this.switchToChannel = autojoin;
			});
		}

		this.dismissDialog();
	}

	handleNetworkRemove() {
		let client = this.clients.values().next().value;

		client.send({
			command: "BOUNCER",
			params: ["DELNETWORK", this.state.dialogData.id],
		});

		this.dismissDialog();
	}

	componentDidMount() {
		setupKeybindings(this);
	}

	render() {
		if (this.state.loading) {
			return html`<section id="connect"></section>`;
		}

		let activeBuffer = null, activeServer = null, activeBouncerNetwork = null;
		if (this.state.buffers.get(this.state.activeBuffer)) {
			activeBuffer = this.state.buffers.get(this.state.activeBuffer);
			activeServer = this.state.servers.get(activeBuffer.server);

			let bouncerNetID = activeServer.bouncerNetID;
			if (bouncerNetID) {
				activeBouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
			}
		}

		if (this.state.connectForm) {
			let status = activeServer ? activeServer.status : ServerStatus.DISCONNECTED;
			let connecting = status === ServerStatus.CONNECTING || status === ServerStatus.REGISTERING;
			return html`
				<section id="connect">
					<${ConnectForm}
						error=${this.state.error}
						params=${this.state.connectParams}
						auth=${this.config.server.auth}
						connecting=${connecting}
						onSubmit=${this.handleConnectSubmit}
					/>
				</section>
			`;
		}

		let bufferHeader = null;
		if (activeBuffer) {
			let activeUser = null;
			if (activeBuffer.type == BufferType.NICK) {
				activeUser = activeServer.users.get(activeBuffer.name);
			}

			bufferHeader = html`
				<section id="buffer-header">
					<${BufferHeader}
						buffer=${activeBuffer}
						server=${activeServer}
						user=${activeUser}
						bouncerNetwork=${activeBouncerNetwork}
						onChannelClick=${this.handleChannelClick}
						onClose=${() => this.close(activeBuffer)}
						onJoin=${() => this.handleJoinClick(activeBuffer)}
						onReconnect=${() => this.reconnect()}
						onAddNetwork=${this.handleAddNetworkClick}
						onManageNetwork=${() => this.handleManageNetworkClick(activeBuffer.server)}
					/>
				</section>
			`;
		}

		let memberList = null;
		if (activeBuffer && activeBuffer.type == BufferType.CHANNEL) {
			memberList = html`
				<section
						id="member-list"
						class=${this.state.openPanels.memberList ? "expand" : ""}
				>
					<button
						class="expander"
						onClick=${this.toggleMemberList}
					>
						<span></span>
						<span></span>
					</button>
					<section>
						<section id="member-list-header">
							${activeBuffer.members.size} users
						</section>
						<${MemberList}
							members=${activeBuffer.members}
							users=${activeServer.users}
							onNickClick=${this.handleNickClick}
						/>
					</section>
				</section>
			`;
		}

		let dialog = null;
		let dialogData = this.state.dialogData || {};
		let dialogBody;
		switch (this.state.dialog) {
		case "network":
			let isNew = !dialogData.id;
			let title = isNew ? "Add network" : "Edit network";
			dialog = html`
				<${Dialog} title=${title} onDismiss=${this.dismissDialog}>
					<${NetworkForm}
						onSubmit=${this.handleNetworkSubmit}
						onRemove=${this.handleNetworkRemove}
						params=${dialogData.params}
						autojoin=${dialogData.autojoin}
						isNew=${isNew}
					/>
				</>
			`;
			break;
		case "help":
			dialog = html`
				<${Dialog} title="Help" onDismiss=${this.dismissDialog}>
					<${Help}/>
				</>
			`;
			break;
		case "join":
			dialog = html`
				<${Dialog} title="Join channel" onDismiss=${this.dismissDialog}>
					<${JoinForm} channel=${dialogData.channel} onSubmit=${this.handleJoinSubmit}/>
				</>
			`;
			break;
		case "auth":
			if (dialogData.loading) {
				dialogBody = html`<p>Logging in…</p>`;
			} else {
				dialogBody = html`
					<${AuthForm} username=${dialogData.username} onSubmit=${this.handleAuthSubmit}/>
				`;
			}
			dialog = html`
				<${Dialog} title="Login to ${getServerName(activeServer, activeBouncerNetwork)}" onDismiss=${this.dismissDialog}>
					${dialogBody}
				</>
			`;
			break;
		case "register":
			if (dialogData.loading) {
				dialogBody = html`<p>Creating account…</p>`;
			} else {
				dialogBody = html`
					<${RegisterForm} emailRequired=${dialogData.emailRequired} onSubmit=${this.handleRegisterSubmit}/>
				`;
			}
			dialog = html`
				<${Dialog} title="Register a new ${getServerName(activeServer, activeBouncerNetwork)} account" onDismiss=${this.dismissDialog}>
					${dialogBody}
				</>
			`;
			break;
		case "verify":
			if (dialogData.loading) {
				dialogBody = html`<p>Verifying account…</p>`;
			} else {
				dialogBody = html`
					<${VerifyForm} account=${dialogData.account} message=${dialogData.message} onSubmit=${this.handleVerifySubmit}/>
				`;
			}
			dialog = html`
				<${Dialog} title="Verify ${getServerName(activeServer, activeBouncerNetwork)} account" onDismiss=${this.dismissDialog}>
					${dialogBody}
				</>
			`;
			break;
		}

		let error = null;
		if (this.state.error) {
			error = html`
				<div id="error-msg">
					${this.state.error}
					${" "}
					<button onClick=${this.handleDismissError}>×</button>
				</div>
			`;
		}

		let composerReadOnly = false;
		if (activeServer && activeServer.status !== ServerStatus.REGISTERED) {
			composerReadOnly = true;
		}

		let commandOnly = false
		if (activeBuffer && activeBuffer.type === BufferType.SERVER) {
			commandOnly = true
		}

		return html`
			<section
					id="buffer-list"
					class=${this.state.openPanels.bufferList ? "expand" : ""}
			>
				<${BufferList}
					buffers=${this.state.buffers}
					servers=${this.state.servers}
					bouncerNetworks=${this.state.bouncerNetworks}
					activeBuffer=${this.state.activeBuffer}
					onBufferClick=${this.handleBufferListClick}
					onBufferClose=${this.handleBufferListClose}
				/>
				<button
					class="expander"
					onClick=${this.toggleBufferList}
				>
					<span></span>
					<span></span>
				</button>
			</section>
			${bufferHeader}
			<${ScrollManager}
				target=${this.buffer}
				stickTo=".logline"
				scrollKey=${this.state.activeBuffer}
				onScrollTop=${this.handleBufferScrollTop}
			>
				<section id="buffer" ref=${this.buffer} tabindex="-1">
					<${Buffer}
						buffer=${activeBuffer}
						server=${activeServer}
						bouncerNetwork=${activeBouncerNetwork}
						onChannelClick=${this.handleChannelClick}
						onNickClick=${this.handleNickClick}
						onAuthClick=${() => this.handleAuthClick(activeBuffer.server)}
						onRegisterClick=${() => this.handleRegisterClick(activeBuffer.server)}
						onVerifyClick=${this.handleVerifyClick}
					/>
				</section>
			</>
			${memberList}
			<${Composer}
				ref=${this.composer}
				readOnly=${composerReadOnly}
				onSubmit=${this.handleComposerSubmit}
				autocomplete=${this.autocomplete}
				commandOnly=${commandOnly}
			/>
			${dialog}
			${error}
		`;
	}
}
