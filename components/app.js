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
import { SERVER_BUFFER, BufferType, ReceiptType, NetworkStatus, Unread } from "../state.js";
import commands from "../commands.js";
import { setup as setupKeybindings } from "../keybindings.js";
import * as store from "../store.js";

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
	});

const CHATHISTORY_MAX_SIZE = 4000;

var messagesCount = 0;

function parseQueryString() {
	var query = window.location.search.substring(1);
	var params = {};
	query.split('&').forEach((s) => {
		if (!s) {
			return;
		}
		var pair = s.split('=');
		params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
	});
	return params;
}

function fillConnectParams(params) {
	var host = window.location.host || "localhost:8080";
	var proto = "wss:";
	if (window.location.protocol != "https:") {
		proto = "ws:";
	}
	var path = window.location.pathname || "/";
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

/* Insert a message in an immutable list of sorted messages. */
function insertMessage(list, msg) {
	if (list.length == 0) {
		return [msg];
	} else if (list[list.length - 1].tags.time <= msg.tags.time) {
		return list.concat(msg);
	}

	var insertBefore = -1;
	for (var i = 0; i < list.length; i++) {
		var other = list[i];
		if (msg.tags.time < other.tags.time) {
			insertBefore = i;
			break;
		}
	}
	console.assert(insertBefore >= 0, "");

	list = [ ...list ];
	list.splice(insertBefore, 0, msg);
	return list;
}

function debounce(f, delay) {
	var timeout = null;
	return (...args) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			timeout = null;
			f(...args);
		}, delay);
	};
}

function isServerBuffer(buf) {
	return buf.type == BufferType.SERVER;
}

/* Returns 1 if a should appear after b, -1 if a should appear before b, or
 * 0 otherwise. */
function compareBuffers(a, b) {
	if (a.network != b.network) {
		return a.network > b.network ? 1 : -1;
	}
	if (isServerBuffer(a) != isServerBuffer(b)) {
		return isServerBuffer(b) ? 1 : -1;
	}
	if (a.name != b.name) {
		return a.name > b.name ? 1 : -1;
	}
	return 0;
}

function updateState(state, updater) {
	var updated;
	if (typeof updater === "function") {
		updated = updater(state, state);
	} else {
		updated = updater;
	}
	if (state === updated || !updated) {
		return;
	}
	return { ...state, ...updated };
}

function getActiveNetworkID(state) {
	var buf = state.buffers.get(state.activeBuffer);
	if (!buf) {
		return null;
	}
	return buf.network;
}

function getBuffer(state, id) {
	switch (typeof id) {
	case "number":
		return state.buffers.get(id);
	case "object":
		if (id.id) {
			return state.buffers.get(id.id);
		}

		var netID = id.network, name = id.name;
		if (!netID) {
			netID = getActiveNetworkID(state);
		}

		var cm = irc.CaseMapping.RFC1459;
		var network = state.networks.get(netID);
		if (network) {
			cm = irc.CaseMapping.byName(network.isupport.get("CASEMAPPING")) || cm;
		}

		var nameCM = cm(name);
		for (var buf of state.buffers.values()) {
			if (buf.network === netID && cm(buf.name) === nameCM) {
				return buf;
			}
		}
		return null;
	default:
		throw new Error("Invalid buffer ID type: " + (typeof id));
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
		networks: new Map(),
		buffers: new Map(),
		bouncerNetworks: new Map(),
		activeBuffer: null,
		dialog: null,
		error: null,
		openPanels: {
			bufferList: false,
			memberList: false,
		},
	};
	config = {};
	clients = new Map();
	endOfHistory = new Map();
	receipts = new Map();
	buffer = createRef();
	composer = createRef();
	lastNetworkID = 0;
	lastBufferID = 0;
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
		this.config = config;

		var connectParams = {};

		if (config.server) {
			connectParams.url = config.server.url;
			if (Array.isArray(config.server.autojoin)) {
				connectParams.autojoin = config.server.autojoin;
			} else {
				connectParams.autojoin = [config.server.autojoin];
			}
		}

		var autoconnect = store.autoconnect.load();
		if (autoconnect) {
			connectParams = {
				...connectParams,
				...autoconnect,
				autoconnect: true,
			};
		}

		var queryParams = parseQueryString();
		if (queryParams.server) {
			connectParams.url = queryParams.server;
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

		this.setState((state) => {
			return { connectParams: { ...state.connectParams, ...connectParams } };
		});

		if (connectParams.autoconnect) {
			this.connect(connectParams);
		}
	}

	dismissError(event) {
		event.preventDefault();
		this.setState({ error: null });
	}

	setNetworkState(id, updater, callback) {
		this.setState((state) => {
			var net = state.networks.get(id);
			if (!net) {
				return;
			}

			var updated = updateState(net, updater);
			if (!updated) {
				return;
			}

			var networks = new Map(state.networks);
			networks.set(id, updated);
			return { networks };
		}, callback);
	}

	setBufferState(id, updater, callback) {
		this.setState((state) => {
			var buf = getBuffer(state, id);
			if (!buf) {
				return;
			}

			var updated = updateState(buf, updater);
			if (!updated) {
				return;
			}

			var buffers = new Map(state.buffers);
			buffers.set(buf.id, updated);
			return { buffers };
		}, callback);
	}

	createBuffer(netID, name, callback) {
		var id = null;
		this.setState((state) => {
			if (getBuffer(state, { network: netID, name })) {
				return;
			}

			this.lastBufferID++;
			id = this.lastBufferID;

			var type;
			if (name == SERVER_BUFFER) {
				type = BufferType.SERVER;
			} else if (this.isChannel(name)) {
				type = BufferType.CHANNEL;
			} else {
				type = BufferType.NICK;
			}

			var client = this.clients.get(netID);
			var cm = client ? client.cm : irc.CaseMapping.RFC1459;

			var bufferList = Array.from(state.buffers.values());
			bufferList.push({
				id,
				name,
				type,
				network: netID,
				serverInfo: null, // if server
				topic: null, // if channel
				members: new irc.CaseMapMap(null, cm), // if channel
				who: null, // if nick
				offline: false, // if nick
				messages: [],
				unread: Unread.NONE,
			});
			bufferList = bufferList.sort(compareBuffers);
			var buffers = new Map(bufferList.map((buf) => [buf.id, buf]));
			return { buffers };
		}, () => {
			if (callback) {
				callback(id);
			}
		});
	}

	switchBuffer(id) {
		var buf;
		this.setState((state) => {
			buf = getBuffer(state, id);
			if (!buf) {
				return;
			}
			return { activeBuffer: buf.id };
		}, () => {
			if (!buf) {
				return;
			}

			var lastReadReceipt = this.getReceipt(buf.name, ReceiptType.READ);
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
			var lastMsg = buf.messages[buf.messages.length - 1];
			this.setReceipt(buf.name, ReceiptType.READ, lastMsg);
		});
	}

	saveReceipts() {
		store.receipts.put(this.receipts);
	}

	getReceipt(target, type) {
		var receipts = this.receipts.get(target);
		if (!receipts) {
			return undefined;
		}
		return receipts[type];
	}

	hasReceipt(target, type, msg) {
		var receipt = this.getReceipt(target, type);
		return receipt && msg.tags.time <= receipt.time;
	}

	setReceipt(target, type, msg) {
		var receipt = this.getReceipt(target, type);
		if (this.hasReceipt(target, type, msg)) {
			return;
		}
		this.receipts.set(target, {
			...this.receipts.get(target),
			[type]: { time: msg.tags.time },
		});
		this.saveReceipts();
	}

	latestReceipt(type) {
		var last = null;
		this.receipts.forEach((receipts, target) => {
			var delivery = receipts[type];
			if (target == "*" || !delivery || !delivery.time) {
				return;
			}
			if (!last || delivery.time > last.time) {
				last = delivery;
			}
		});
		return last;
	}

	addMessage(netID, bufName, msg) {
		var client = this.clients.get(netID);

		msg.key = messagesCount;
		messagesCount++;

		msg.isHighlight = irc.isHighlight(msg, client.nick);

		if (!msg.tags) {
			msg.tags = {};
		}
		if (!msg.tags.time) {
			msg.tags.time = irc.formatDate(new Date());
		}

		var isDelivered = this.hasReceipt(bufName, ReceiptType.DELIVERED, msg);
		var isRead = this.hasReceipt(bufName, ReceiptType.READ, msg);
		// TODO: messages coming from infinite scroll shouldn't trigger notifications

		var msgUnread = Unread.NONE;
		if ((msg.command == "PRIVMSG" || msg.command == "NOTICE") && !isRead) {
			var target = msg.params[0];
			var text = msg.params[1];

			var kind;
			if (msg.isHighlight) {
				msgUnread = Unread.HIGHLIGHT;
				kind = "highlight";
			} else if (target == client.nick) {
				msgUnread = Unread.HIGHLIGHT;
				kind = "private message";
			} else {
				msgUnread = Unread.MESSAGE;
			}

			if (msgUnread == Unread.HIGHLIGHT && window.Notification && Notification.permission === "granted" && !isDelivered && !irc.parseCTCP(msg)) {
				var title = "New " + kind + " from " + msg.prefix.name;
				if (this.isChannel(target)) {
					title += " in " + target;
				}
				var notif = new Notification(title, {
					body: stripANSI(text),
					requireInteraction: true,
				});
				notif.addEventListener("click", () => {
					// TODO: scroll to message
					this.switchBuffer({ network: netID, name: target });
				});
			}
		}

		if (!client.isMyNick(msg.prefix.name) && (msg.command != "PART" && msg.comand != "QUIT")) {
			this.createBuffer(netID, bufName);
		}

		this.setReceipt(bufName, ReceiptType.DELIVERED, msg);

		this.setBufferState({ network: netID, name: bufName }, (buf) => {
			// TODO: set unread if scrolled up
			var unread = buf.unread;
			var lastReadReceipt = buf.lastReadReceipt;
			if (this.state.activeBuffer != buf.id) {
				unread = Unread.union(unread, msgUnread);
			} else {
				this.setReceipt(bufName, ReceiptType.READ, msg);
				lastReadReceipt = this.getReceipt(bufName, ReceiptType.READ);
			}
			var messages = insertMessage(buf.messages, msg);
			return { messages, unread, lastReadReceipt };
		});
	}

	connect(params) {
		this.lastNetworkID++;
		var netID = this.lastNetworkID;

		this.setState((state) => {
			var networks = new Map(state.networks);
			networks.set(netID, {
				id: netID,
				status: NetworkStatus.CONNECTING,
				isupport: new Map(),
			});
			return { networks };
		});
		this.setState({ connectParams: params });

		var client = new Client(fillConnectParams(params));
		this.clients.set(netID, client);

		client.addEventListener("status", () => {
			this.setNetworkState(netID, { status: client.status });
		});

		client.addEventListener("message", (event) => {
			this.handleMessage(netID, event.detail.message);
		});

		client.addEventListener("error", (event) => {
			this.setState({ error: event.detail });
		});

		this.createBuffer(netID, SERVER_BUFFER);
		if (!this.state.activeBuffer) {
			this.switchBuffer({ network: netID, name: SERVER_BUFFER });
		}

		if (params.autojoin.length > 0) {
			this.switchToChannel = params.autojoin[0];
		}

		if (this.config.server && typeof this.config.server.ping === "number") {
			client.setPingInterval(this.config.server.ping);
		}
	}

	disconnect(netID) {
		if (!netID) {
			netID = getActiveNetworkID(this.state);
		}

		var client = this.clients.get(netID);
		if (client) {
			this.clients.delete(netID);
			client.disconnect();
		}
	}

	reconnect(netID) {
		if (!netID) {
			netID = getActiveNetworkID(this.state);
		}

		var client = this.clients.get(netID);
		if (client) {
			client.reconnect();
		}
	}

	networkFromBouncerNetwork(bouncerNetworkID) {
		for (var [id, client] of this.clients) {
			if (client.params.bouncerNetwork === bouncerNetworkID) {
				return id;
			}
		}
		return null;
	}

	handleMessage(netID, msg) {
		var client = this.clients.get(netID);
		switch (msg.command) {
		case irc.RPL_WELCOME:
			if (this.state.connectParams.autojoin.length > 0) {
				client.send({
					command: "JOIN",
					params: [this.state.connectParams.autojoin.join(",")],
				});
			}

			var lastReceipt = this.latestReceipt(ReceiptType.READ);
			if (lastReceipt && lastReceipt.time && client.enabledCaps["draft/chathistory"] && (!client.enabledCaps["soju.im/bouncer-networks"] || client.params.bouncerNetwork)) {
				var now = irc.formatDate(new Date());
				client.fetchHistoryTargets(now, lastReceipt.time).then((targets) => {
					targets.forEach((target) => {
						var from = this.getReceipt(target, ReceiptType.READ);
						if (!from) {
							from = lastReceipt;
						}
						var to = { time: msg.tags.time || irc.formatDate(new Date()) };
						this.fetchBacklog(client, target.name, from, to);
					});
				});
			}
			break;
		case irc.RPL_MYINFO:
			// TODO: parse available modes
			var serverInfo = {
				name: msg.params[1],
				version: msg.params[2],
			};
			this.setBufferState({ network: netID, name: SERVER_BUFFER }, { serverInfo });
			break;
		case irc.RPL_ISUPPORT:
			this.setNetworkState(netID, (network) => {
				return { isupport: new Map(client.isupport) };
			});
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				state.buffers.forEach((buf) => {
					if (buf.network != netID) {
						return;
					}
					var members = new irc.CaseMapMap(buf.members, client.cm);
					buffers.set(buf.id, { ...buf, members });
				});
				return { buffers };
			});
			break;
		case irc.RPL_NOTOPIC:
			var channel = msg.params[1];

			this.setBufferState({ network: netID, name: channel }, { topic: null });
			break;
		case irc.RPL_TOPIC:
			var channel = msg.params[1];
			var topic = msg.params[2];

			this.setBufferState({ network: netID, name: channel }, { topic });
			break;
		case irc.RPL_TOPICWHOTIME:
			// Ignore
			break;
		case irc.RPL_NAMREPLY:
			var channel = msg.params[2];
			var membersList = msg.params[3].split(" ");

			this.setBufferState({ network: netID, name: channel }, (buf) => {
				var members = new irc.CaseMapMap(buf.members);
				membersList.forEach((s) => {
					var member = irc.parseMembership(s);
					members.set(member.nick, member.prefix);
				});

				return { members };
			});
			break;
		case irc.RPL_ENDOFNAMES:
			break;
		case irc.RPL_WHOREPLY:
			var last = msg.params[msg.params.length - 1];
			var who = {
				username: msg.params[2],
				hostname: msg.params[3],
				server: msg.params[4],
				nick: msg.params[5],
				away: msg.params[6] == 'G', // H for here, G for gone
				realname: last.slice(last.indexOf(" ") + 1),
			};

			this.setBufferState({ network: netID, name: who.nick }, { who, offline: false });

			this.addMessage(netID, SERVER_BUFFER, msg);
			break;
		case irc.RPL_ENDOFWHO:
			var target = msg.params[1];
			if (!this.isChannel(target) && target.indexOf("*") < 0) {
				// Not a channel nor a mask, likely a nick
				this.setBufferState({ network: netID, name: target }, (buf) => {
					// TODO: mark user offline if we have old WHO info but this
					// WHO reply is empty
					if (buf.who) {
						return;
					}
					return { offline: true };
				});
			}

			this.addMessage(netID, SERVER_BUFFER, msg);
			break;
		case "MODE":
			var target = msg.params[0];
			if (this.isChannel(target)) {
				this.addMessage(netID, target, msg);
			}
			this.handleMode(netID, msg);
			break;
		case "NOTICE":
		case "PRIVMSG":
			var target = msg.params[0];
			if (client.isMyNick(target)) {
				if (client.cm(msg.prefix.name) === client.cm(client.serverPrefix.name)) {
					target = SERVER_BUFFER;
				} else {
					target = msg.prefix.name;
				}
			}
			this.addMessage(netID, target, msg);
			break;
		case "JOIN":
			var channel = msg.params[0];

			this.createBuffer(netID, channel);
			this.setBufferState({ network: netID, name: channel }, (buf) => {
				var members = new irc.CaseMapMap(buf.members);
				members.set(msg.prefix.name, "");
				return { members };
			});
			if (!client.isMyNick(msg.prefix.name)) {
				this.addMessage(netID, channel, msg);
			}
			if (channel == this.switchToChannel) {
				this.switchBuffer({ network: netID, name: channel });
				this.switchToChannel = null;
			}
			break;
		case "PART":
			var channel = msg.params[0];

			this.setBufferState({ network: netID, name: channel }, (buf) => {
				var members = new irc.CaseMapMap(buf.members);
				members.delete(msg.prefix.name);
				return { members };
			});
			this.addMessage(netID, channel, msg);

			if (client.isMyNick(msg.prefix.name)) {
				this.receipts.delete(channel);
				this.saveReceipts();
			}
			break;
		case "KICK":
			var channel = msg.params[0];
			var user = msg.params[1];

			this.setBufferState({ network: netID, name: channel }, (buf) => {
				var members = new irc.CaseMapMap(buf.members);
				members.delete(user);
				return { members };
			});
			this.addMessage(netID, channel, msg);

			if (client.isMyNick(msg.prefix.name)) {
				this.receipts.delete(channel);
				this.saveReceipts();
			}
			break;
		case "QUIT":
			var affectedBuffers = [];
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				state.buffers.forEach((buf) => {
					if (buf.network != netID) {
						return;
					}
					if (!buf.members.has(msg.prefix.name) && client.cm(buf.name) !== client.cm(msg.prefix.name)) {
						return;
					}
					var members = new irc.CaseMapMap(buf.members);
					members.delete(msg.prefix.name);
					var offline = client.cm(buf.name) === client.cm(msg.prefix.name);
					buffers.set(buf.id, { ...buf, members, offline });
					affectedBuffers.push(buf.name);
				});
				return { buffers };
			});
			affectedBuffers.forEach((name) => this.addMessage(netID, name, msg));
			break;
		case "NICK":
			var newNick = msg.params[0];

			var affectedBuffers = [];
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				state.buffers.forEach((buf) => {
					if (buf.network != netID) {
						return;
					}
					if (!buf.members.has(msg.prefix.name)) {
						return;
					}
					var members = new irc.CaseMapMap(buf.members);
					members.set(newNick, members.get(msg.prefix.name));
					members.delete(msg.prefix.name);
					buffers.set(buf.id, { ...buf, members });
					affectedBuffers.push(buf.name);
				});
				return { buffers };
			});
			affectedBuffers.forEach((name) => this.addMessage(netID, name, msg));
			break;
		case "SETNAME":
			this.setBufferState({ network: netID, name: msg.prefix.name }, (buf) => {
				var who = { ...buf.who, realname: msg.params[0] };
				return { who }
			});
			break;
		case "TOPIC":
			var channel = msg.params[0];
			var topic = msg.params[1];

			this.setBufferState({ network: netID, name: channel }, { topic });
			this.addMessage(netID, channel, msg);
			break;
		case "AWAY":
			var awayMessage = msg.params[0];

			this.setBufferState({ network: netID, name: msg.prefix.name }, (buf) => {
				var who = { ...buf.who, away: !!awayMessage };
				return { who };
			});
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

			var id = msg.params[1];
			var attrs = null;
			if (msg.params[2] !== "*") {
				attrs = irc.parseTags(msg.params[2]);
			}

			var isNew = false;
			this.setState((state) => {
				var bouncerNetworks = new Map(state.bouncerNetworks);
				if (!attrs) {
					bouncerNetworks.delete(id);
				} else {
					var prev = bouncerNetworks.get(id);
					isNew = prev === undefined;
					attrs = { ...prev, ...attrs };
					bouncerNetworks.set(id, attrs);
				}
				return { bouncerNetworks };
			}, () => {
				if (!attrs) {
					var netID = this.networkFromBouncerNetwork(id);
					if (netID) {
						this.close({ network: netID, name: SERVER_BUFFER });
					}
				} else if (isNew) {
					this.connect({
						...client.params,
						bouncerNetwork: id,
					});
				}
			});
			break;
		case "CAP":
		case "AUTHENTICATE":
		case "PING":
		case "PONG":
		case "BATCH":
		case "TAGMSG":
		case "CHATHISTORY":
			// Ignore these
			break;
		default:
			if (irc.isError(msg.command) && msg.command != irc.ERR_NOMOTD) {
				var description = msg.params[msg.params.length - 1];
				this.setState({ error: description });
			}
			this.addMessage(netID, SERVER_BUFFER, msg);
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
		var netID = getActiveNetworkID(this.state);
		var buf = getBuffer(this.state, { network: netID, name: channel });
		if (buf) {
			this.switchBuffer(buf.id);
		} else {
			this.open(channel);
		}
	}

	handleNickClick(nick) {
		this.open(nick);
	}

	isChannel(name) {
		// TODO: use the ISUPPORT token if available
		return irc.STD_CHANNEL_TYPES.indexOf(name[0]) >= 0;
	}

	fetchBacklog(client, target, after, before) {
		client.fetchHistoryBetween(target, after, before, CHATHISTORY_MAX_SIZE).catch((err) => {
			this.setState({ error: "Failed to fetch history for '" + taregt + "': " + err });
			this.receipts.delete(channel);
			this.saveReceipts();
		});
	}

	open(target) {
		var netID = getActiveNetworkID(this.state);
		var client = this.clients.get(netID);

		if (this.isChannel(target)) {
			this.switchToChannel = target;
			client.send({ command: "JOIN", params: [target] });
		} else {
			client.who(target);
			this.createBuffer(netID, target);
			this.switchBuffer({ network: netID, name: target });
		}
	}

	close(id) {
		var buf = getBuffer(this.state, id);
		if (!buf) {
			return;
		}

		switch (buf.type) {
		case BufferType.SERVER:
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				for (var [id, b] of state.buffers) {
					if (b.network === buf.network) {
						buffers.delete(id);
					}
				}

				var activeBuffer = state.activeBuffer;
				if (activeBuffer && state.buffers.get(activeBuffer).network === buf.network) {
					if (buffers.size > 0) {
						activeBuffer = buffers.keys().next().value;
					} else {
						activeBuffer = null;
					}
				}

				return { buffers, activeBuffer };
			});

			var client = this.clients.get(buf.network);
			var disconnectAll = client && !client.params.bouncerNetwork && client.enabledCaps["soju.im/bouncer-networks"];

			this.disconnect(buf.network);

			this.setState((state) => {
				var networks = new Map(state.networks);
				networks.delete(buf.network);
				return { networks };
			});

			if (disconnectAll) {
				for (var netID of this.clients.keys()) {
					this.close({ network: netID, name: SERVER_BUFFER });
				}
			}

			// TODO: only clear local storage if this network is stored there
			if (buf.network == 1) {
				store.autoconnect.put(null);
			}
			break;
		case BufferType.CHANNEL:
			var client = this.clients.get(buf.network);
			client.send({ command: "PART", params: [buf.name] });
			// fallthrough
		case BufferType.NICK:
			this.switchBuffer({ name: SERVER_BUFFER });
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				buffers.delete(buf.id);
				return { buffers };
			});

			this.receipts.delete(buf.name);
			this.saveReceipts();
			break;
		}
	}

	executeCommand(s) {
		var parts = s.split(" ");
		var name = parts[0].toLowerCase().slice(1);
		var args = parts.slice(1);

		var cmd = commands[name];
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

		var netID = getActiveNetworkID(this.state);
		var client = this.clients.get(netID);

		var msg = { command: "PRIVMSG", params: [target, text] };
		client.send(msg);

		if (!client.enabledCaps["echo-message"]) {
			msg.prefix = { name: client.nick };
			this.addMessage(netID, target, msg);
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

		var buf = this.state.buffers.get(this.state.activeBuffer);
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
			var openPanels = {
				...state.openPanels,
				bufferList: !state.openPanels.bufferList,
			};
			return { openPanels };
		});
	}

	toggleMemberList() {
		this.setState((state) => {
			var openPanels = {
				...state.openPanels,
				memberList: !state.openPanels.memberList,
			};
			return { openPanels };
		});
	}

	closeBufferList() {
		this.setState((state) => {
			var openPanels = {
				...state.openPanels,
				bufferList: false,
			};
			return { openPanels };
		});
	}

	closeMemberList() {
		this.setState((state) => {
			var openPanels = {
				...state.openPanels,
				memberList: false,
			};
			return { openPanels };
		});
	}

	handleJoinClick(netID) {
		this.setState({ dialog: "join", joinDialog: { network: netID } });
	}

	handleJoinSubmit(data) {
		var client = this.clients.get(this.state.joinDialog.network);

		this.switchToChannel = data.channel;
		client.send({ command: "JOIN", params: [data.channel] });

		this.setState({ dialog: null, joinDialog: null });
	}

	autocomplete(prefix) {
		function fromList(l, prefix) {
			prefix = prefix.toLowerCase();
			var repl = null;
			for (var item of l) {
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
			var repl = fromList(Object.keys(commands), prefix.slice(1));
			if (repl) {
				repl = "/" + repl;
			}
			return repl;
		}

		var buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf || !buf.members) {
			return null;
		}
		return fromList(buf.members.keys(), prefix);
	}

	openHelp() {
		this.setState({ dialog: "help" });
	}

	handleBufferScrollTop() {
		var buf = this.state.buffers.get(this.state.activeBuffer);
		if (!buf || buf.type == BufferType.SERVER) {
			return;
		}

		var client = this.clients.get(buf.network);

		if (!client || !client.enabledCaps["draft/chathistory"] || !client.enabledCaps["server-time"]) {
			return;
		}
		if (this.endOfHistory.get(buf.id)) {
			return;
		}

		var before;
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

	handleManageNetworkClick(netID) {
		var network = this.state.networks.get(netID);
		var bouncerNetID = network.isupport.get("BOUNCER_NETID");
		var bouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
		this.setState({
			dialog: "network",
			networkDialog: {
				id: bouncerNetID,
				params: bouncerNetwork,
			},
		});
	}

	handleNetworkSubmit(attrs) {
		var client = this.clients.values().next().value;

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
		var client = this.clients.values().next().value;

		client.send({
			command: "BOUNCER",
			params: ["DELNETWORK", this.state.networkDialog.id],
		});

		this.setState({ dialog: null, networkDialog: null });
	}

	handleMode(netID, msg) {
		var client = this.clients.get(netID);
		var chanmodes = client.isupport.get("CHANMODES") || irc.STD_CHANMODES;
		var prefix = client.isupport.get("PREFIX") || "";

		var prefixByMode = new Map(irc.parseMemberships(prefix).map((membership) => {
			return [membership.mode, membership.prefix];
		}));

		var typeByMode = new Map();
		var [a, b, c, d] = chanmodes.split(",");
		Array.from(a).forEach((mode) => typeByMode.set(mode, "A"));
		Array.from(b).forEach((mode) => typeByMode.set(mode, "B"));
		Array.from(c).forEach((mode) => typeByMode.set(mode, "C"));
		Array.from(d).forEach((mode) => typeByMode.set(mode, "D"));
		prefixByMode.forEach((prefix, mode) => typeByMode.set(mode, "B"));

		var channel = msg.params[0];
		var change = msg.params[1];
		var args = msg.params.slice(2);

		var plusMinus = null;
		var j = 0;
		for (var i = 0; i < change.length; i++) {
			if (change[i] === "+" || change[i] === "-") {
				plusMinus = change[i];
				continue;
			}
			if (!plusMinus) {
				throw new Error("malformed mode string: missing plus/minus");
			}

			var mode = change[i];
			var add = plusMinus === "+";

			var modeType = typeByMode.get(mode);
			if (!modeType) {
				continue;
			}

			var arg = null;
			if (modeType === "A" || modeType === "B" || (modeType === "C" && add)) {
				arg = args[j];
				j++;
			}

			if (prefixByMode.has(mode)) {
				this.handlePrefixChange(netID, channel, arg, prefixByMode.get(mode), add);
			}

			// XXX: If we eventually want to handle any mode changes with
			// some special logic, this would be the place to. Not sure
			// what we'd want to do in that regard, though.
		}
	}

	handlePrefixChange(netID, channel, nick, letter, add) {
		var client = this.clients.get(netID);
		var prefix = client.isupport.get("PREFIX") || "";

		var prefixPrivs = new Map(irc.parseMemberships(prefix).map((membership, i) => {
			return [membership.prefix, i];
		}));

		this.setBufferState({ network: netID, name: channel }, (buf) => {
			var members = new irc.CaseMapMap(buf.members);
			var membership = members.get(nick);
			if (add) {
				var i = membership.indexOf(letter);
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
		var activeBuffer = null, activeNetwork = null, activeBouncerNetwork = null;
		var isBouncer = false;
		if (this.state.buffers.get(this.state.activeBuffer)) {
			activeBuffer = this.state.buffers.get(this.state.activeBuffer);
			activeNetwork = this.state.networks.get(activeBuffer.network);

			var activeClient = this.clients.get(activeBuffer.network);
			isBouncer = activeClient && activeClient.enabledCaps["soju.im/bouncer-networks"];

			var bouncerNetID = activeNetwork.isupport.get("BOUNCER_NETID");
			if (bouncerNetID) {
				activeBouncerNetwork = this.state.bouncerNetworks.get(bouncerNetID);
			}
		}

		if (!activeNetwork || (activeNetwork.status !== NetworkStatus.REGISTERED && !activeBuffer)) {
			// TODO: using key=connectParams trashes the ConnectForm state on update
			return html`
				<section id="connect">
					<${ConnectForm}
						error=${this.state.error}
						params=${this.state.connectParams}
						disabled=${activeNetwork}
						onSubmit=${this.handleConnectSubmit}
						key=${this.state.connectParams}
					/>
				</section>
			`;
		}

		var bufferHeader = null;
		if (activeBuffer) {
			bufferHeader = html`
				<section id="buffer-header">
					<${BufferHeader}
						buffer=${activeBuffer}
						network=${activeNetwork}
						isBouncer=${isBouncer}
						bouncerNetwork=${activeBouncerNetwork}
						onChannelClick=${this.handleChannelClick}
						onClose=${() => this.close(activeBuffer)}
						onJoin=${() => this.handleJoinClick(activeBuffer.network)}
						onAddNetwork=${this.handleAddNetworkClick}
						onManageNetwork=${() => this.handleManageNetworkClick(activeBuffer.network)}
					/>
				</section>
			`;
		}

		var memberList = null;
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

		var dialog = null;
		switch (this.state.dialog) {
		case "network":
			var title = this.state.networkDialog ? "Edit network" : "Add network";
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

		var error = null;
		if (this.state.error) {
			error = html`
				<p id="error-msg">
					${this.state.error}
					${" "}
					<a href="#" onClick=${this.dismissError}>×</a>
				</p>
			`;
		}

		var composerReadOnly = false;
		if (activeBuffer && activeBuffer.type === BufferType.SERVER) {
			composerReadOnly = true;
		}
		if (activeNetwork && activeNetwork.status !== NetworkStatus.REGISTERED) {
			composerReadOnly = true;
		}

		return html`
			<section
					id="buffer-list"
					class=${this.state.openPanels.bufferList ? "expand" : ""}
			>
				<${BufferList}
					buffers=${this.state.buffers}
					networks=${this.state.networks}
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
