import * as irc from "../lib/irc.js";
import Client from "../lib/client.js";
import * as oauth2 from "../lib/oauth2.js";
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
import SettingsForm from "./settings-form.js";
import SwitcherForm from "./switcher-form.js";
import Composer from "./composer.js";
import ScrollManager from "./scroll-manager.js";
import Dialog from "./dialog.js";
import { html, Component, createRef } from "../lib/index.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { SERVER_BUFFER, BufferType, ReceiptType, ServerStatus, Unread, BufferEventsDisplayMode, State, getServerName, receiptFromMessage, isReceiptBefore, isMessageBeforeReceipt, SettingsContext } from "../state.js";
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
	query.split("&").forEach((s) => {
		if (!s) {
			return;
		}
		let pair = s.split("=");
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

function showNotification(title, options) {
	if (!window.Notification || Notification.permission !== "granted") {
		return null;
	}

	// This can still fail due to:
	// https://bugs.chromium.org/p/chromium/issues/detail?id=481856
	try {
		return new Notification(title, options);
	} catch (err) {
		console.error("Failed to show notification: ", err);
		return null;
	}
}

function getReceipt(stored, type) {
	if (!stored || !stored.receipts) {
		return null;
	}
	return stored.receipts[ReceiptType.READ];
}

function getLatestReceipt(bufferStore, server, type) {
	let buffers = bufferStore.list(server);
	let last = null;
	for (let buf of buffers) {
		if (buf.name === "*") {
			continue;
		}
		let receipt = getReceipt(buf, type);
		if (isReceiptBefore(last, receipt)) {
			last = receipt;
		}
	}
	return last;
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
	messageNotifications = new Set();
	baseTitle = null;

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
		this.handleOpenSettingsClick = this.handleOpenSettingsClick.bind(this);
		this.handleSettingsChange = this.handleSettingsChange.bind(this);
		this.handleSettingsDisconnect = this.handleSettingsDisconnect.bind(this);
		this.handleSwitchSubmit = this.handleSwitchSubmit.bind(this);

		this.state.settings = {
			...this.state.settings,
			...store.settings.load(),
		};

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
	async handleConfig(config) {
		let connectParams = { ...this.state.connectParams };

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

		if (connectParams.autoconnect && config.server.auth === "mandatory") {
			console.error("Error in config.json: cannot set server.autoconnect = true and server.auth = \"mandatory\"");
			connectParams.autoconnect = false;
		}
		if (config.server.auth === "oauth2" && (!config.oauth2 || !config.oauth2.url || !config.oauth2.client_id)) {
			console.error("Error in config.json: server.auth = \"oauth2\" requires oauth2 settings");
			config.server.auth = null;
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

		if (!connectParams.nick && connectParams.autoconnect) {
			connectParams.nick = "user-*";
		}
		if (connectParams.nick && connectParams.nick.includes("*")) {
			let placeholder = Math.random().toString(36).substr(2, 7);
			connectParams.nick = connectParams.nick.replace("*", placeholder);
		}

		if (config.server.auth === "oauth2" && !connectParams.saslOauthBearer) {
			if (queryParams.error) {
				console.error("OAuth 2.0 authorization failed: ", queryParams.error);
				this.showError("Authentication failed: " + (queryParams.error_description || queryParams.error));
				return;
			}

			if (!queryParams.code) {
				this.redirectOauth2Authorize();
				return;
			}

			// Strip code from query params, to prevent page refreshes from
			// trying to exchange the code again
			let url = new URL(window.location.toString());
			url.searchParams.delete("code");
			url.searchParams.delete("state");
			window.history.replaceState(null, "", url.toString());

			let saslOauthBearer;
			try {
				saslOauthBearer = await this.exchangeOauth2Code(queryParams.code);
			} catch (err) {
				this.showError(err);
				return;
			}

			connectParams.saslOauthBearer = saslOauthBearer;

			if (saslOauthBearer.username && !connectParams.nick) {
				connectParams.nick = saslOauthBearer.username;
			}
		}

		if (autojoin.length > 0) {
			if (connectParams.autoconnect) {
				// Ask the user whether they want to join that new channel.
				// TODO: support multiple channels here
				this.autoOpenURL = { host: "", entity: autojoin[0] };
			} else {
				connectParams.autojoin = autojoin;
			}
		}

		this.setState({ loading: false, connectParams: connectParams });

		if (connectParams.autoconnect) {
			this.setState({ connectForm: false });
			this.connect(connectParams);
		}
	}

	async redirectOauth2Authorize() {
		let serverMetadata;
		try {
			serverMetadata = await oauth2.fetchServerMetadata(this.config.oauth2.url);
		} catch (err) {
			console.error("Failed to fetch OAuth 2.0 server metadata:", err);
			this.showError("Failed to fetch OAuth 2.0 server metadata");
			return;
		}

		oauth2.redirectAuthorize({
			serverMetadata,
			clientId: this.config.oauth2.client_id,
			redirectUri: window.location.toString(),
			scope: this.config.oauth2.scope,
		});
	}

	async exchangeOauth2Code(code) {
		let serverMetadata = await oauth2.fetchServerMetadata(this.config.oauth2.url);

		let redirectUri = new URL(window.location.toString());
		redirectUri.searchParams.delete("code");
		redirectUri.searchParams.delete("state");

		let data = await oauth2.exchangeCode({
			serverMetadata,
			redirectUri: redirectUri.toString(),
			code,
			clientId: this.config.oauth2.client_id,
			clientSecret: this.config.oauth2.client_secret,
		});

		// TODO: handle expires_in/refresh_token
		let token = data.access_token;

		let username = null;
		if (serverMetadata.introspection_endpoint) {
			try {
				let data = await oauth2.introspectToken({
					serverMetadata,
					token,
					clientId: this.config.oauth2.client_id,
					clientSecret: this.config.oauth2.client_secret,
				});
				username = data.username;
			} catch (err) {
				console.warn("Failed to introspect OAuth 2.0 token:", err);
			}
		}

		return { token, username };
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

		this.bufferStore.put({
			name,
			server: client.params,
			closed: false,
		});
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

	sendReadReceipt(client, storedBuffer) {
		if (!client.supportsReadMarker()) {
			return;
		}
		let readReceipt = storedBuffer.receipts[ReceiptType.READ];
		if (storedBuffer.name === "*" || !readReceipt) {
			return;
		}
		client.setReadMarker(storedBuffer.name, readReceipt.time);
	}

	switchBuffer(id) {
		let buf;
		this.setState((state) => {
			buf = State.getBuffer(state, id);
			if (!buf) {
				return;
			}

			let client = this.clients.get(buf.server);
			let stored = this.bufferStore.get({ name: buf.name, server: client.params });
			let prevReadReceipt = getReceipt(stored, ReceiptType.READ);
			// TODO: only mark as read if user scrolled at the bottom
			let update = State.updateBuffer(state, buf.id, {
				unread: Unread.NONE,
				prevReadReceipt,
			});

			return { ...update, activeBuffer: buf.id };
		}, () => {
			if (!buf) {
				return;
			}

			if (this.buffer.current) {
				this.buffer.current.focus();
			}

			let client = this.clients.get(buf.server);

			for (let notif of this.messageNotifications) {
				if (client.cm(notif.data.bufferName) === client.cm(buf.name)) {
					notif.close();
				}
			}

			if (buf.messages.length > 0) {
				let lastMsg = buf.messages[buf.messages.length - 1];
				let stored = {
					name: buf.name,
					server: client.params,
					unread: Unread.NONE,
					receipts: { [ReceiptType.READ]: receiptFromMessage(lastMsg) },
				};
				if (this.bufferStore.put(stored)) {
					this.sendReadReceipt(client, stored);
				}
			}

			let server = this.state.servers.get(buf.server);
			if (buf.type === BufferType.NICK && !server.users.has(buf.name)) {
				this.whoUserBuffer(buf.name, buf.server);
			}

			if (buf.type === BufferType.CHANNEL && !buf.hasInitialWho) {
				this.whoChannelBuffer(buf.name, buf.server);
			}

			if (buf.type !== BufferType.SERVER) {
				document.title = buf.name + ' · ' + this.baseTitle;
			} else {
				document.title = this.baseTitle;
			}
		});
	}

	prepareChatMessage(serverID, msg) {
		// Treat server-wide broadcasts as highlights. They're sent by server
		// operators and can contain important information.
		if (msg.isHighlight === undefined) {
			let client = this.clients.get(serverID);
			msg.isHighlight = irc.isHighlight(msg, client.nick, client.cm) || irc.isServerBroadcast(msg);
		}

		if (!msg.tags) {
			// Can happen for outgoing messages for instance
			msg.tags = {};
		}
		if (!msg.tags.time) {
			msg.tags.time = irc.formatDate(new Date());
		}
	}

	addChatMessage(serverID, bufName, msg) {
		this.prepareChatMessage(serverID, msg);
		let bufID = { server: serverID, name: bufName };
		this.setState((state) => State.addMessage(state, msg, bufID));
	}

	handleChatMessage(serverID, bufName, msg) {
		let client = this.clients.get(serverID);

		this.prepareChatMessage(serverID, msg);

		let stored = this.bufferStore.get({ name: bufName, server: client.params });
		let deliveryReceipt = getReceipt(stored, ReceiptType.DELIVERED);
		let readReceipt = getReceipt(stored, ReceiptType.READ);
		let isDelivered = isMessageBeforeReceipt(msg, deliveryReceipt);
		let isRead = isMessageBeforeReceipt(msg, readReceipt);

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
					tag: "msg,server=" + serverID + ",from=" + msg.prefix.name + ",to=" + bufName,
					data: { bufferName: bufName, message: msg },
				});
				if (notif) {
					notif.addEventListener("click", () => {
						// TODO: scroll to message
						this.switchBuffer({ server: serverID, name: bufName });
					});
					notif.addEventListener("close", () => {
						this.messageNotifications.delete(notif);
					});
					this.messageNotifications.add(notif);
				}
			}
		}
		if (msg.command === "INVITE" && client.isMyNick(msg.params[0])) {
			msgUnread = Unread.HIGHLIGHT;

			let channel = msg.params[1];
			let notif = new Notification("Invitation to " + channel, {
				body: msg.prefix.name + " has invited you to " + channel,
				requireInteraction: true,
				tag: "invite,server=" + serverID + ",from=" + msg.prefix.name + ",channel=" + channel,
				actions: [{
					action: "accept",
					title: "Accept",
				}],
			});
			if (notif) {
				notif.addEventListener("click", (event) => {
					if (event.action === "accept") {
						let stored = {
							name: bufName,
							server: client.params,
							receipts: { [ReceiptType.READ]: receiptFromMessage(msg) },
						};
						if (this.bufferStore.put(stored)) {
							this.sendReadReceipt(client, stored);
						}
						this.open(channel, serverID);
					} else {
						// TODO: scroll to message
						this.switchBuffer({ server: serverID, name: bufName });
					}
				});
			}
		}

		// Open a new buffer if the message doesn't come from me or is a
		// self-message
		if ((!client.isMyNick(msg.prefix.name) || client.isMyNick(bufName)) && (msg.command != "PART" && msg.comand != "QUIT")) {
			this.createBuffer(serverID, bufName);
		}

		let bufID = { server: serverID, name: bufName };
		this.setState((state) => State.addMessage(state, msg, bufID));
		this.setBufferState(bufID, (buf) => {
			// TODO: set unread if scrolled up
			let unread = buf.unread;
			let prevReadReceipt = buf.prevReadReceipt;
			let receipts = { [ReceiptType.DELIVERED]: receiptFromMessage(msg) };

			if (this.state.activeBuffer !== buf.id) {
				unread = Unread.union(unread, msgUnread);
			} else {
				receipts[ReceiptType.READ] = receiptFromMessage(msg);
			}

			// Don't show unread marker for my own messages
			if (client.isMyNick(msg.prefix.name) && !isMessageBeforeReceipt(msg, prevReadReceipt)) {
				prevReadReceipt = receiptFromMessage(msg);
			}

			let stored = {
				name: buf.name,
				server: client.params,
				unread,
				receipts,
			};
			if (this.bufferStore.put(stored)) {
				this.sendReadReceipt(client, stored);
			}
			return { unread, prevReadReceipt };
		});
	}

	connect(params) {
		// Merge our previous connection params so that config options such as
		// the ping interval are applied
		params = {
			...this.state.connectParams,
			...params,
		};

		let serverID = null;
		this.setState((state) => {
			let update;
			[serverID, update] = State.createServer(state);
			return update;
		});
		this.setState({ connectParams: params });

		let client = new Client({
			...fillConnectParams(params),
			eventPlayback: this.state.settings.bufferEvents !== BufferEventsDisplayMode.HIDE,
		});
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
					let context = msg.tags['+draft/channel-context'];
					if (context && client.isChannel(context) && State.getBuffer(this.state, { server: serverID, name: context })) {
						target = context;
					} else {
						target = msg.prefix.name;
					}
				}
			}

			// Don't open a new buffer if this is just a NOTICE or a garbage
			// CTCP message
			let openNewBuffer = true;
			if (msg.command !== "PRIVMSG") {
				openNewBuffer = false;
			} else {
				let ctcp = irc.parseCTCP(msg);
				if (ctcp && ctcp.command !== "ACTION") {
					openNewBuffer = false;
				}
			}
			if (!openNewBuffer && !State.getBuffer(this.state, { server: serverID, name: target })) {
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
		case irc.RPL_CHANNEL_URL:
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
		case "MARKREAD":
			// Ignore these
			return [];
		default:
			return [SERVER_BUFFER];
		}
	}

	handleMessage(serverID, msg) {
		let client = this.clients.get(serverID);

		if (irc.findBatchByType(msg, "chathistory")) {
			return; // Handled by the caller
		}

		let destBuffers = this.routeMessage(serverID, msg);

		this.setState((state) => State.handleMessage(state, msg, serverID, client));

		let target, channel;
		switch (msg.command) {
		case irc.RPL_WELCOME:
			this.fetchBacklog(serverID);
			break;
		case irc.RPL_ENDOFMOTD:
		case irc.ERR_NOMOTD:
			// These messages are used to indicate the end of the ISUPPORT list

			// Restore opened channel and user buffers
			let join = [];
			for (let buf of this.bufferStore.list(client.params)) {
				if (buf.name === "*" || buf.closed) {
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
		case "MARKREAD":
			target = msg.params[0];
			let bound = msg.params[1];
			if (bound === "*" || !bound.startsWith("timestamp=")) {
				break;
			}
			let readReceipt = { time: bound.replace("timestamp=", "") };
			let stored = this.bufferStore.get({ name: target, server: client.params });
			if (isReceiptBefore(readReceipt, getReceipt(stored, ReceiptType.READ))) {
				break;
			}
			for (let notif of this.messageNotifications) {
				if (client.cm(notif.data.bufferName) !== client.cm(target)) {
					continue;
				}
				if (isMessageBeforeReceipt(notif.data.message, readReceipt)) {
					notif.close();
				}
			}
			let unread;
			let closed = true;
			this.setBufferState({ server: serverID, name: target }, (buf) => {
				closed = false;

				// Re-compute unread status
				unread = Unread.NONE;
				for (let i = buf.messages.length - 1; i >= 0; i--) {
					let msg = buf.messages[i];
					if (msg.command !== "PRIVMSG" && msg.command !== "NOTICE") {
						continue;
					}
					if (isMessageBeforeReceipt(msg, readReceipt)) {
						break;
					}

					if (msg.isHighlight || client.isMyNick(buf.name)) {
						unread = Unread.HIGHLIGHT;
						break;
					}

					unread = Unread.MESSAGE;
				}

				return { unread };
			}, () => {
				this.bufferStore.put({
					name: target,
					server: client.params,
					unread,
					closed,
					receipts: { [ReceiptType.READ]: readReceipt },
				});
			});
			break;
		default:
			if (irc.isError(msg.command) && msg.command != irc.ERR_NOMOTD) {
				let description = msg.params[msg.params.length - 1];
				this.showError(description);
			}
		}

		destBuffers.forEach((bufName) => {
			this.handleChatMessage(serverID, bufName, msg);
		});
	}

	async fetchBacklog(serverID) {
		let client = this.clients.get(serverID);
		if (!client.caps.enabled.has("draft/chathistory")) {
			return;
		}
		if (client.caps.enabled.has("soju.im/bouncer-networks") && !client.params.bouncerNetwork) {
			return;
		}

		let lastReceipt = getLatestReceipt(this.bufferStore, client.params, ReceiptType.DELIVERED);
		if (!lastReceipt) {
			return;
		}

		let now = irc.formatDate(new Date());
		let targets = await client.fetchHistoryTargets(now, lastReceipt.time);
		targets.forEach(async (target) => {
			let from = lastReceipt;
			let to = { time: now };

			// Maybe we've just received a READ update from the
			// server, avoid over-fetching history
			let stored = this.bufferStore.get({ name: target.name, server: client.params });
			let readReceipt = getReceipt(stored, ReceiptType.READ);
			if (isReceiptBefore(from, readReceipt)) {
				from = readReceipt;
			}

			// If we already have messages stored for the target,
			// fetch all messages we've missed
			let buf = State.getBuffer(this.state, { server: serverID, name: target.name });
			if (buf && buf.messages.length > 0) {
				let lastMsg = buf.messages[buf.messages.length - 1];
				from = receiptFromMessage(lastMsg);
			}

			// Query read marker if this is a user (ie, we haven't received
			// the read marker as part of a JOIN burst)
			if (client.supportsReadMarker() && client.isNick(target.name)) {
				client.fetchReadMarker(target.name);
			}

			let result;
			try {
				result = await client.fetchHistoryBetween(target.name, from, to, CHATHISTORY_MAX_SIZE);
			} catch (err) {
				console.error("Failed to fetch backlog for '" + target.name + "': ", err);
				this.showError("Failed to fetch backlog for '" + target.name + "'");
				return;
			}

			for (let msg of result.messages) {
				let destBuffers = this.routeMessage(serverID, msg);
				for (let bufName of destBuffers) {
					this.handleChatMessage(serverID, bufName, msg);
				}
			}
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

	whoUserBuffer(target, serverID) {
		let client = this.clients.get(serverID);

		client.who(target, {
			fields: ["flags", "hostname", "nick", "realname", "username", "account"],
		});
		client.monitor(target);

		if (client.supportsReadMarker()) {
			client.fetchReadMarker(target);
		}
	}

	async whoChannelBuffer(target, serverID) {
		let client = this.clients.get(serverID);

		// Prevent multiple WHO commands for the same channel in parallel
		this.setBufferState({ name: target, server: serverID }, { hasInitialWho: true });

		let hasInitialWho = false;
		try {
			await client.who(target, {
				fields: ["flags", "hostname", "nick", "realname", "username", "account"],
			});
			hasInitialWho = true;
		} finally {
			this.setBufferState({ name: target, server: serverID }, { hasInitialWho });
		}
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
			let isFirstServer = this.state.servers.keys().next().value === buf.server;

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
			if (isFirstServer) {
				store.autoconnect.put(null);
			}
			break;
		case BufferType.CHANNEL:
			if (buf.joined) {
				client.send({ command: "PART", params: [buf.name] });
			}
			// fallthrough
		case BufferType.NICK:
			if (this.state.activeBuffer === buf.id) {
				this.switchBuffer({ name: SERVER_BUFFER });
			}
			this.setState((state) => {
				let buffers = new Map(state.buffers);
				buffers.delete(buf.id);
				return { buffers };
			});

			client.unmonitor(buf.name);

			this.bufferStore.put({
				name: buf.name,
				server: client.params,
				closed: true,
			});
			break;
		}
	}

	disconnectAll() {
		this.close(this.state.buffers.keys().next().value);
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
			this.handleChatMessage(serverID, target, msg);
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

	async handleBufferScrollTop() {
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

		let result = await client.fetchHistoryBefore(buf.name, before, limit);
		this.endOfHistory.set(buf.id, !result.more);

		if (result.messages.length > 0) {
			let msg = result.messages[result.messages.length - 1];
			let receipts = { [ReceiptType.DELIVERED]: receiptFromMessage(msg) };
			if (this.state.activeBuffer === buf.id) {
				receipts[ReceiptType.READ] = receiptFromMessage(msg);
			}
			let stored = {
				name: buf.name,
				server: client.params,
				receipts,
			};
			if (this.bufferStore.put(stored)) {
				this.sendReadReceipt(client, stored);
			}
			this.setBufferState(buf, ({ prevReadReceipt }) => {
				if (!isMessageBeforeReceipt(msg, prevReadReceipt)) {
					prevReadReceipt = receiptFromMessage(msg);
				}
				return { prevReadReceipt };
			});
		}

		for (let msg of result.messages) {
			this.addChatMessage(buf.server, buf.name, msg);
		}
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

	async handleNetworkSubmit(attrs, autojoin) {
		let client = this.clients.values().next().value;

		this.dismissDialog();

		if (this.state.dialogData && this.state.dialogData.id) {
			if (Object.keys(attrs).length == 0) {
				return;
			}

			client.send({
				command: "BOUNCER",
				params: ["CHANGENETWORK", this.state.dialogData.id, irc.formatTags(attrs)],
			});
		} else {
			attrs = { ...attrs, tls: "1" };
			let id = await client.createBouncerNetwork(attrs);
			if (!autojoin) {
				return;
			}

			// By this point, bouncer-networks-notify should've advertised
			// the new network
			let serverID = this.serverFromBouncerNetwork(id);
			let client = this.clients.get(serverID);
			client.params.autojoin = [autojoin];

			this.switchToChannel = autojoin;
		}
	}

	handleNetworkRemove() {
		let client = this.clients.values().next().value;

		client.send({
			command: "BOUNCER",
			params: ["DELNETWORK", this.state.dialogData.id],
		});

		this.dismissDialog();
	}

	handleOpenSettingsClick() {
		let showProtocolHandler = false;
		for (let [id, client] of this.clients) {
			if (client.caps.enabled.has("soju.im/bouncer-networks")) {
				showProtocolHandler = true;
				break;
			}
		}

		this.openDialog("settings", { showProtocolHandler });
	}

	handleSettingsChange(settings) {
		store.settings.put(settings);
		this.setState({ settings });
	}

	handleSettingsDisconnect() {
		this.dismissDialog();
		this.disconnectAll();
	}

	handleSwitchSubmit(buf) {
		this.dismissDialog();
		if (buf) {
			this.switchBuffer(buf);
		}
	}

	componentDidMount() {
		this.baseTitle = document.title;
		setupKeybindings(this);
	}

	componentWillUnmount() {
		document.title = this.baseTitle;
	}

	render() {
		if (this.state.loading) {
			let error = null;
			if (this.state.error) {
				error = html`<form><p class="error-text">${this.state.error}</p></form>`;
			}
			return html`<section id="connect">${error}</section>`;
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
						onOpenSettings=${this.handleOpenSettingsClick}
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
		case "settings":
			dialog = html`
				<${Dialog} title="Settings" onDismiss=${this.dismissDialog}>
					<${SettingsForm}
						settings=${this.state.settings}
						showProtocolHandler=${dialogData.showProtocolHandler}
						onChange=${this.handleSettingsChange}
						onDisconnect=${this.handleSettingsDisconnect}
						onClose=${this.dismissDialog}
					/>
				</>
			`;
			break;
		case "switch":
			dialog = html`
				<${Dialog} title="Switch to a channel or user" onDismiss=${this.dismissDialog}>
					<${SwitcherForm}
						buffers=${this.state.buffers}
						servers=${this.state.servers}
						bouncerNetworks=${this.state.bouncerNetworks}
						onSubmit=${this.handleSwitchSubmit}/>
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

		let commandOnly = false;
		let privmsgMaxLen;
		if (activeBuffer && activeBuffer.type === BufferType.SERVER) {
			commandOnly = true;
		} else if (activeBuffer) {
			let client = this.clients.get(activeBuffer.server);
			privmsgMaxLen = irc.getMaxPrivmsgLen(client.isupport, client.nick, activeBuffer.name);
		}

		let app = html`
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
						settings=${this.state.settings}
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
				maxLen=${privmsgMaxLen}
			/>
			${dialog}
			${error}
		`;

		return html`
			<${SettingsContext.Provider} value=${this.state.settings}>
				${app}
			</>
		`;
	}
}
