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
import Composer from "./composer.js";
import ScrollManager from "./scroll-manager.js";
import Dialog from "./dialog.js";
import { html, Component, createRef } from "../lib/index.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { SERVER_BUFFER, BufferType, ReceiptType, ServerStatus, Unread, State } from "../state.js";
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

export default class App extends Component {
	state = {
		connectParams: {
			url: null,
			pass: null,
			username: null,
			realname: null,
			nick: null,
			saslPlain: null,
			autoconnect: false,
			autojoin: [],
		},
		servers: new Map(),
		buffers: new Map(),
		bouncerNetworks: new Map(),
		activeBuffer: null,
		connectForm: true,
		dialog: null,
		error: null,
		openPanels: {
			bufferList: false,
			memberList: false,
		},
	};
	config = { ...baseConfig };
	clients = new Map();
	endOfHistory = new Map();
	receipts = new Map();
	buffer = createRef();
	composer = createRef();
	switchToChannel = null;

	constructor(props) {
		super(props);

		this.handleConnectSubmit = this.handleConnectSubmit.bind(this);
		this.handleJoinSubmit = this.handleJoinSubmit.bind(this);
		this.handleBufferListClick = this.handleBufferListClick.bind(this);
		this.toggleBufferList = this.toggleBufferList.bind(this);
		this.toggleMemberList = this.toggleMemberList.bind(this);
		this.handleComposerSubmit = this.handleComposerSubmit.bind(this);
		this.handleChannelClick = this.handleChannelClick.bind(this);
		this.handleNickClick = this.handleNickClick.bind(this);
		this.autocomplete = this.autocomplete.bind(this);
		this.handleBufferScrollTop = this.handleBufferScrollTop.bind(this);
		this.handleDialogDismiss = this.handleDialogDismiss.bind(this);
		this.handleAddNetworkClick = this.handleAddNetworkClick.bind(this);
		this.handleNetworkSubmit = this.handleNetworkSubmit.bind(this);
		this.handleNetworkRemove = this.handleNetworkRemove.bind(this);
		this.dismissError = this.dismissError.bind(this);

		this.saveReceipts = debounce(this.saveReceipts.bind(this), 500);

		this.receipts = store.receipts.load();

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
	 * - Default server URL constructed from the current URL location
	 */
	handleConfig(config) {
		let connectParams = {};

		if (config.server) {
			connectParams.url = config.server.url;
			if (Array.isArray(config.server.autojoin)) {
				connectParams.autojoin = config.server.autojoin;
			} else if (config.server.autojoin) {
				connectParams.autojoin = [config.server.autojoin];
			}
		}

		let autoconnect = store.autoconnect.load();
		if (autoconnect) {
			connectParams = {
				...connectParams,
				...autoconnect,
				autoconnect: true,
			};
		}

		let queryParams = parseQueryString();
		if (queryParams.server) {
			connectParams.url = queryParams.server;

			// When using a custom server, some configuration options don't
			// make sense anymore.
			config.server.auth = null;
		}
		if (queryParams.nick) {
			connectParams.nick = queryParams.nick;
		}
		if (queryParams.channels) {
			connectParams.autojoin = queryParams.channels.split(",");
		}

		if (window.location.hash) {
			connectParams.autojoin = window.location.hash.split(",");
		}

		this.config = config;

		this.setState((state) => {
			return {
				connectParams: {
					...state.connectParams,
					...connectParams,
				},
			};
		});

		if (connectParams.autoconnect) {
			this.setState({ connectForm: false });
			this.connect(connectParams);
		}
	}

	dismissError(event) {
		event.preventDefault();
		this.setState({ error: null });
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

	createBuffer(serverID, name) {
		let id = null;
		this.setState((state) => {
			let client = this.clients.get(serverID);
			let updated;
			[id, updated] = State.createBuffer(state, name, serverID, client);
			return updated;
		});
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

			let lastReadReceipt = this.getReceipt(buf.name, ReceiptType.READ);
			// TODO: only mark as read if user scrolled at the bottom
			this.setBufferState(buf.id, {
				unread: Unread.NONE,
				lastReadReceipt,
			});

			if (this.composer.current) {
				this.composer.current.focus();
			}

			if (buf.messages.length == 0) {
				return;
			}
			let lastMsg = buf.messages[buf.messages.length - 1];
			this.setReceipt(buf.name, ReceiptType.READ, lastMsg);
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
			let delivery = receipts[type];
			if (target == "*" || !delivery || !delivery.time) {
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

		msg.isHighlight = irc.isHighlight(msg, client.nick, client.cm);

		if (!msg.tags) {
			msg.tags = {};
		}
		if (!msg.tags.time) {
			msg.tags.time = irc.formatDate(new Date());
		}

		let isDelivered = this.hasReceipt(bufName, ReceiptType.DELIVERED, msg);
		let isRead = this.hasReceipt(bufName, ReceiptType.READ, msg);
		// TODO: messages coming from infinite scroll shouldn't trigger notifications

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

		if (!client.isMyNick(msg.prefix.name) && (msg.command != "PART" && msg.comand != "QUIT")) {
			this.createBuffer(serverID, bufName);
		}

		this.setReceipt(bufName, ReceiptType.DELIVERED, msg);

		let bufID = { server: serverID, name: bufName };
		this.setState((state) => State.addMessage(state, msg, bufID));
		this.setBufferState(bufID, (buf) => {
			// TODO: set unread if scrolled up
			let unread = buf.unread;
			let lastReadReceipt = buf.lastReadReceipt;
			if (this.state.activeBuffer != buf.id) {
				unread = Unread.union(unread, msgUnread);
			} else {
				this.setReceipt(bufName, ReceiptType.READ, msg);
				lastReadReceipt = this.getReceipt(bufName, ReceiptType.READ);
			}
			return { unread, lastReadReceipt };
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
		this.clients.set(serverID, client);
		this.setServerState(serverID, { status: client.status });

		client.addEventListener("status", () => {
			this.setServerState(serverID, { status: client.status });
			if (client.status === Client.Status.REGISTERED) {
				this.setState({ connectForm: false });
			}
		});

		client.addEventListener("message", (event) => {
			this.handleMessage(serverID, event.detail.message);
		});

		client.addEventListener("error", (event) => {
			this.setState({ error: event.detail });
		});

		this.createBuffer(serverID, SERVER_BUFFER);
		if (!this.state.activeBuffer) {
			this.switchBuffer({ server: serverID, name: SERVER_BUFFER });
		}

		if (params.autojoin.length > 0) {
			this.switchToChannel = params.autojoin[0];
		}

		if (this.config.server && typeof this.config.server.ping !== "undefined") {
			client.setPingInterval(this.config.server.ping);
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

	handleMessage(serverID, msg) {
		let client = this.clients.get(serverID);
		let chatHistoryBatch = irc.findBatchByType(msg, "chathistory");

		this.setState((state) => State.handleMessage(state, msg, serverID, client));

		let target, channel, affectedBuffers;
		switch (msg.command) {
		case irc.RPL_WELCOME:
			if (this.state.connectParams.autojoin.length > 0) {
				client.send({
					command: "JOIN",
					params: [this.state.connectParams.autojoin.join(",")],
				});
			}

			let lastReceipt = this.latestReceipt(ReceiptType.READ);
			if (lastReceipt && lastReceipt.time && client.enabledCaps["draft/chathistory"] && (!client.enabledCaps["soju.im/bouncer-networks"] || client.params.bouncerNetwork)) {
				let now = irc.formatDate(new Date());
				client.fetchHistoryTargets(now, lastReceipt.time).then((targets) => {
					targets.forEach((target) => {
						let from = this.getReceipt(target, ReceiptType.READ);
						if (!from) {
							from = lastReceipt;
						}
						let to = { time: msg.tags.time || irc.formatDate(new Date()) };
						this.fetchBacklog(client, target.name, from, to);
					});
				});
			}
			break;
		case "MODE":
			target = msg.params[0];
			if (client.isChannel(target)) {
				this.addMessage(serverID, target, msg);
			}
			if (!chatHistoryBatch) {
				this.handleMode(serverID, msg);
			}
			break;
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

			let allowedPrefixes = client.isupport.get("STATUSMSG");
			if (allowedPrefixes) {
				let parts = irc.parseTargetPrefix(target, allowedPrefixes);
				if (client.isChannel(parts.name)) {
					target = parts.name;
				}
			}

			this.addMessage(serverID, target, msg);
			break;
		case "JOIN":
			channel = msg.params[0];

			if (!client.isMyNick(msg.prefix.name)) {
				this.addMessage(serverID, channel, msg);
			}
			if (channel == this.switchToChannel) {
				this.switchBuffer({ server: serverID, name: channel });
				this.switchToChannel = null;
			}
			break;
		case "PART":
			channel = msg.params[0];

			this.addMessage(serverID, channel, msg);

			if (!chatHistoryBatch && client.isMyNick(msg.prefix.name)) {
				this.receipts.delete(channel);
				this.saveReceipts();
			}
			break;
		case "KICK":
			channel = msg.params[0];
			this.addMessage(serverID, channel, msg);
			break;
		case "QUIT":
			affectedBuffers = [];
			if (chatHistoryBatch) {
				affectedBuffers.push(chatHistoryBatch.params[0]);
			} else {
				this.setState((state) => {
					let buffers = new Map(state.buffers);
					state.buffers.forEach((buf) => {
						if (buf.server != serverID) {
							return;
						}
						if (!buf.members.has(msg.prefix.name) && client.cm(buf.name) !== client.cm(msg.prefix.name)) {
							return;
						}
						let members = new irc.CaseMapMap(buf.members);
						members.delete(msg.prefix.name);
						let offline = client.cm(buf.name) === client.cm(msg.prefix.name);
						buffers.set(buf.id, { ...buf, members, offline });
						affectedBuffers.push(buf.name);
					});
					return { buffers };
				});
			}

			affectedBuffers.forEach((name) => this.addMessage(serverID, name, msg));
			break;
		case "NICK":
			let newNick = msg.params[0];

			affectedBuffers = [];
			if (chatHistoryBatch) {
				affectedBuffers.push(chatHistoryBatch.params[0]);
			} else {
				this.setState((state) => {
					let buffers = new Map(state.buffers);
					state.buffers.forEach((buf) => {
						if (buf.server != serverID) {
							return;
						}
						if (!buf.members.has(msg.prefix.name)) {
							return;
						}
						let members = new irc.CaseMapMap(buf.members);
						members.set(newNick, members.get(msg.prefix.name));
						members.delete(msg.prefix.name);
						buffers.set(buf.id, { ...buf, members });
						affectedBuffers.push(buf.name);
					});
					return { buffers };
				});
			}

			affectedBuffers.forEach((name) => this.addMessage(serverID, name, msg));
			break;
		case "TOPIC":
			channel = msg.params[0];
			this.addMessage(serverID, channel, msg);
			break;
		case "INVITE":
			channel = msg.params[1];

			// TODO: find a more reliable way to do this
			let bufName = channel;
			if (!State.getBuffer(this.state, { server: serverID, name: channel })) {
				bufName = SERVER_BUFFER;
			}

			this.addMessage(serverID, bufName, msg);
			break;
		case "BOUNCER":
			if (msg.params[0] !== "NETWORK") {
				break; // We're only interested in network updates
			}

			if (client.isupport.has("BOUNCER_NETID")) {
				// This cn happen if the user has specified a network to bind
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
				let bouncerNetworks = new Map(state.bouncerNetworks);
				if (!attrs) {
					bouncerNetworks.delete(id);
				} else {
					let prev = bouncerNetworks.get(id);
					isNew = prev === undefined;
					attrs = { ...prev, ...attrs };
					bouncerNetworks.set(id, attrs);
				}
				return { bouncerNetworks };
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
			});
			break;
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
			this.addMessage(serverID, channel, msg);
			break;
		case irc.RPL_MYINFO:
		case irc.RPL_ISUPPORT:
		case irc.RPL_NOTOPIC:
		case irc.RPL_TOPIC:
		case irc.RPL_TOPICWHOTIME:
		case irc.RPL_NAMREPLY:
		case irc.RPL_ENDOFNAMES:
		case "AWAY":
		case "SETNAME":
		case "CAP":
		case "AUTHENTICATE":
		case "PING":
		case "PONG":
		case "BATCH":
		case "TAGMSG":
		case "CHATHISTORY":
		case "ACK":
			// Ignore these
			break;
		default:
			if (irc.isError(msg.command) && msg.command != irc.ERR_NOMOTD) {
				let description = msg.params[msg.params.length - 1];
				this.setState({ error: description });
			}
			this.addMessage(serverID, SERVER_BUFFER, msg);
		}
	}

	handleConnectSubmit(connectParams) {
		this.setState({ error: null });

		if (connectParams.autoconnect) {
			store.autoconnect.put(connectParams);
		} else {
			store.autoconnect.put(null);
		}

		this.connect(connectParams);
	}

	handleChannelClick(channel) {
		let serverID = State.getActiveServerID(this.state);
		let buf = State.getBuffer(this.state, { server: serverID, name: channel });
		if (buf) {
			this.switchBuffer(buf.id);
		} else {
			this.open(channel);
		}
	}

	handleNickClick(nick) {
		this.open(nick);
	}

	fetchBacklog(client, target, after, before) {
		client.fetchHistoryBetween(target, after, before, CHATHISTORY_MAX_SIZE).catch((err) => {
			this.setState({ error: "Failed to fetch history for '" + taregt + "': " + err });
			this.receipts.delete(channel);
			this.saveReceipts();
		});
	}

	open(target, serverID) {
		if (!serverID) {
			serverID = State.getActiveServerID(this.state);
		}

		let client = this.clients.get(serverID);
		if (client.isServer(target)) {
			this.switchBuffer({ server: serverID });
		} else if (client.isChannel(target)) {
			this.switchToChannel = target;
			client.send({ command: "JOIN", params: [target] });
		} else {
			client.who(target);
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

			let disconnectAll = client && !client.params.bouncerNetwork && client.enabledCaps["soju.im/bouncer-networks"];

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
			}

			// TODO: only clear local storage if this server is stored there
			if (buf.server == 1) {
				store.autoconnect.put(null);
			}
			break;
		case BufferType.CHANNEL:
			client.send({ command: "PART", params: [buf.name] });
			// fallthrough
		case BufferType.NICK:
			this.switchBuffer({ name: SERVER_BUFFER });
			this.setState((state) => {
				let buffers = new Map(state.buffers);
				buffers.delete(buf.id);
				return { buffers };
			});

			this.receipts.delete(buf.name);
			this.saveReceipts();
			break;
		}
	}

	executeCommand(s) {
		let parts = s.split(" ");
		let name = parts[0].toLowerCase().slice(1);
		let args = parts.slice(1);

		let cmd = commands[name];
		if (!cmd) {
			this.setState({ error: `Unknown command "${name}" (run "/help" to get a command list)` });
			return;
		}

		try {
			cmd.execute(this, args);
		} catch (error) {
			console.error(`Failed to execute command "${name}":`, error);
			this.setState({ error: error.message });
		}
	}

	privmsg(target, text) {
		if (target == SERVER_BUFFER) {
			this.setState({ error: "Cannot send message in server buffer" });
			return;
		}

		let serverID = State.getActiveServerID(this.state);
		let client = this.clients.get(serverID);

		let msg = { command: "PRIVMSG", params: [target, text] };
		client.send(msg);

		if (!client.enabledCaps["echo-message"]) {
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

	handleJoinClick(serverID) {
		this.setState({ dialog: "join", joinDialog: { server: serverID } });
	}

	handleJoinSubmit(data) {
		let client = this.clients.get(this.state.joinDialog.server);

		this.switchToChannel = data.channel;
		client.send({ command: "JOIN", params: [data.channel] });

		this.setState({ dialog: null, joinDialog: null });
	}

	autocomplete(prefix) {
		function fromList(l, prefix) {
			prefix = prefix.toLowerCase();
			let repl = null;
			for (let item of l) {
				if (item.toLowerCase().startsWith(prefix)) {
					if (repl) {
						return null;
					}
					repl = item;
				}
			}
			return repl;
		}

		if (prefix.startsWith("/")) {
			let repl = fromList(Object.keys(commands), prefix.slice(1));
			if (repl) {
				repl = "/" + repl;
			}
			return repl;
		}

		let buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf || !buf.members) {
			return null;
		}
		return fromList(buf.members.keys(), prefix);
	}

	openHelp() {
		this.setState({ dialog: "help" });
	}

	handleBufferScrollTop() {
		let buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf || buf.type == BufferType.SERVER) {
			return;
		}

		let client = this.clients.get(buf.server);

		if (!client || !client.enabledCaps["draft/chathistory"] || !client.enabledCaps["server-time"]) {
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

		client.fetchHistoryBefore(buf.name, before, 100).then((result) => {
			this.endOfHistory.set(buf.id, !result.more);
		});
	}

	handleDialogDismiss() {
		this.setState({ dialog: null });
	}

	handleAddNetworkClick() {
		this.setState({ dialog: "network", networkDialog: null });
	}

	handleManageNetworkClick(serverID) {
		let server = this.state.servers.get(serverID);
		let bouncerNetID = server.isupport.get("BOUNCER_NETID");
		let bouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
		this.setState({
			dialog: "network",
			networkDialog: {
				id: bouncerNetID,
				params: bouncerNetwork,
			},
		});
	}

	handleNetworkSubmit(attrs) {
		let client = this.clients.values().next().value;

		if (this.state.networkDialog && this.state.networkDialog.id) {
			if (Object.keys(attrs).length == 0) {
				this.setState({ dialog: null });
				return;
			}

			client.send({
				command: "BOUNCER",
				params: ["CHANGENETWORK", this.state.networkDialog.id, irc.formatTags(attrs)],
			});
		} else {
			attrs = { ...attrs, tls: "1" };
			client.send({
				command: "BOUNCER",
				params: ["ADDNETWORK", irc.formatTags(attrs)],
			});
		}

		this.setState({ dialog: null, networkDialog: null });
	}

	handleNetworkRemove() {
		let client = this.clients.values().next().value;

		client.send({
			command: "BOUNCER",
			params: ["DELNETWORK", this.state.networkDialog.id],
		});

		this.setState({ dialog: null, networkDialog: null });
	}

	handleMode(serverID, msg) {
		let client = this.clients.get(serverID);
		let chanmodes = client.isupport.get("CHANMODES") || irc.STD_CHANMODES;
		let prefix = client.isupport.get("PREFIX") || "";

		let prefixByMode = new Map(irc.parseMembershipModes(prefix).map((membership) => {
			return [membership.mode, membership.prefix];
		}));

		let typeByMode = new Map();
		let [a, b, c, d] = chanmodes.split(",");
		Array.from(a).forEach((mode) => typeByMode.set(mode, "A"));
		Array.from(b).forEach((mode) => typeByMode.set(mode, "B"));
		Array.from(c).forEach((mode) => typeByMode.set(mode, "C"));
		Array.from(d).forEach((mode) => typeByMode.set(mode, "D"));
		prefixByMode.forEach((prefix, mode) => typeByMode.set(mode, "B"));

		let channel = msg.params[0];
		let change = msg.params[1];
		let args = msg.params.slice(2);

		let plusMinus = null;
		let j = 0;
		for (let i = 0; i < change.length; i++) {
			if (change[i] === "+" || change[i] === "-") {
				plusMinus = change[i];
				continue;
			}
			if (!plusMinus) {
				throw new Error("malformed mode string: missing plus/minus");
			}

			let mode = change[i];
			let add = plusMinus === "+";

			let modeType = typeByMode.get(mode);
			if (!modeType) {
				continue;
			}

			let arg = null;
			if (modeType === "A" || modeType === "B" || (modeType === "C" && add)) {
				arg = args[j];
				j++;
			}

			if (prefixByMode.has(mode)) {
				this.handlePrefixChange(serverID, channel, arg, prefixByMode.get(mode), add);
			}

			// XXX: If we eventually want to handle any mode changes with
			// some special logic, this would be the place to. Not sure
			// what we'd want to do in that regard, though.
		}
	}

	handlePrefixChange(serverID, channel, nick, letter, add) {
		let client = this.clients.get(serverID);
		let prefix = client.isupport.get("PREFIX") || "";

		let prefixPrivs = new Map(irc.parseMembershipModes(prefix).map((membership, i) => {
			return [membership.prefix, i];
		}));

		this.setBufferState({ server: serverID, name: channel }, (buf) => {
			let members = new irc.CaseMapMap(buf.members);
			let membership = members.get(nick);
			if (add) {
				let i = membership.indexOf(letter);
				if (i < 0) {
					membership += letter;
				}
			} else {
				membership = membership.replace(letter, "");
			}
			membership = Array.from(membership).sort((a, b) => {
				return prefixPrivs.get(a) - prefixPrivs.get(b);
			}).join("");
			members.set(nick, membership);
			return { members };
		});
	}

	componentDidMount() {
		setupKeybindings(this);
	}

	render() {
		let activeBuffer = null, activeServer = null, activeBouncerNetwork = null;
		let isBouncer = false;
		if (this.state.buffers.get(this.state.activeBuffer)) {
			activeBuffer = this.state.buffers.get(this.state.activeBuffer);
			activeServer = this.state.servers.get(activeBuffer.server);

			let activeClient = this.clients.get(activeBuffer.server);
			isBouncer = activeClient && activeClient.enabledCaps["soju.im/bouncer-networks"];

			let bouncerNetID = activeServer.isupport.get("BOUNCER_NETID");
			if (bouncerNetID) {
				activeBouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
			}
		}

		if (this.state.connectForm) {
			let status = activeServer ? activeServer.status : ServerStatus.DISCONNECTED;
			let connecting = status === ServerStatus.CONNECTING || status === ServerStatus.REGISTERING;
			// TODO: using key=connectParams trashes the ConnectForm state on update
			return html`
				<section id="connect">
					<${ConnectForm}
						error=${this.state.error}
						params=${this.state.connectParams}
						auth=${this.config.server.auth}
						connecting=${connecting}
						onSubmit=${this.handleConnectSubmit}
						key=${this.state.connectParams}
					/>
				</section>
			`;
		}

		let bufferHeader = null;
		if (activeBuffer) {
			bufferHeader = html`
				<section id="buffer-header">
					<${BufferHeader}
						buffer=${activeBuffer}
						server=${activeServer}
						isBouncer=${isBouncer}
						bouncerNetwork=${activeBouncerNetwork}
						onChannelClick=${this.handleChannelClick}
						onClose=${() => this.close(activeBuffer)}
						onJoin=${() => this.handleJoinClick(activeBuffer.server)}
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
							onNickClick=${this.handleNickClick}
						/>
					</section>
				</section>
			`;
		}

		let dialog = null;
		switch (this.state.dialog) {
		case "network":
			let title = this.state.networkDialog ? "Edit network" : "Add network";
			dialog = html`
				<${Dialog} title=${title} onDismiss=${this.handleDialogDismiss}>
					<${NetworkForm}
						onSubmit=${this.handleNetworkSubmit}
						onRemove=${this.handleNetworkRemove}
						params=${this.state.networkDialog ? this.state.networkDialog.params : null}
					/>
				</>
			`;
			break;
		case "help":
			dialog = html`
				<${Dialog} title="Help" onDismiss=${this.handleDialogDismiss}>
					<${Help}/>
				</>
			`;
			break;
		case "join":
			dialog = html`
				<${Dialog} title="Join channel" onDismiss=${this.handleDialogDismiss}>
					<${JoinForm} onSubmit=${this.handleJoinSubmit}/>
				</>
			`;
			break;
		}

		let error = null;
		if (this.state.error) {
			error = html`
				<p id="error-msg">
					${this.state.error}
					${" "}
					<a href="#" onClick=${this.dismissError}>×</a>
				</p>
			`;
		}

		let composerReadOnly = false;
		if (activeBuffer && activeBuffer.type === BufferType.SERVER) {
			composerReadOnly = true;
		}
		if (activeServer && activeServer.status !== ServerStatus.REGISTERED) {
			composerReadOnly = true;
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
					isBouncer=${isBouncer}
					activeBuffer=${this.state.activeBuffer}
					onBufferClick=${this.handleBufferListClick}
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
				<section id="buffer" ref=${this.buffer}>
					<${Buffer}
						buffer=${activeBuffer}
						server=${activeServer}
						onChannelClick=${this.handleChannelClick}
						onNickClick=${this.handleNickClick}/>
				</section>
			</>
			${memberList}
			<${Composer}
				ref=${this.composer}
				readOnly=${composerReadOnly}
				onSubmit=${this.handleComposerSubmit}
				autocomplete=${this.autocomplete}
			/>
			${dialog}
			${error}
		`;
	}
}
