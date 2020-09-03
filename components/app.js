import * as irc from "/lib/irc.js";
import Client from "/lib/client.js";
import Buffer from "/components/buffer.js";
import BufferList from "/components/buffer-list.js";
import BufferHeader from "/components/buffer-header.js";
import MemberList from "/components/member-list.js";
import Connect from "/components/connect.js";
import Composer from "/components/composer.js";
import ScrollManager from "/components/scroll-manager.js";
import { html, Component, createRef } from "/lib/index.js";
import { strip as stripANSI } from "/lib/ansi.js";
import { SERVER_BUFFER, BufferType, ReceiptType, Status, Unread } from "/state.js";
import commands from "/commands.js";
import { setup as setupKeybindings } from "/keybindings.js";

const CHATHISTORY_PAGE_SIZE = 100;
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

function compareBuffers(a, b) {
	if (a.type == BufferType.SERVER) {
		return -1;
	}
	if (b.type == BufferType.SERVER) {
		return 1;
	}

	if (a.name < b.name) {
		return -1;
	}
	if (a.name > b.name) {
		return 1;
	}

	return 0;
}

export default class App extends Component {
	client = null;
	state = {
		connectParams: {
			serverURL: null,
			serverPass: null,
			username: null,
			realname: null,
			nick: null,
			saslPlain: null,
			autoconnect: false,
			autojoin: [],
		},
		status: Status.DISCONNECTED,
		buffers: new Map(),
		activeBuffer: null,
		error: null,
	};
	pendingHistory = Promise.resolve(null);
	endOfHistory = new Map();
	receipts = new Map();
	buffer = createRef();
	composer = createRef();

	constructor(props) {
		super(props);

		this.handleConnectSubmit = this.handleConnectSubmit.bind(this);
		this.handleBufferListClick = this.handleBufferListClick.bind(this);
		this.handleComposerSubmit = this.handleComposerSubmit.bind(this);
		this.handleNickClick = this.handleNickClick.bind(this);
		this.handleJoinClick = this.handleJoinClick.bind(this);
		this.autocomplete = this.autocomplete.bind(this);
		this.handleBufferScrollTop = this.handleBufferScrollTop.bind(this);
		this.dismissError = this.dismissError.bind(this);

		this.saveReceipts = debounce(this.saveReceipts.bind(this), 500);

		if (window.localStorage && localStorage.getItem("autoconnect")) {
			var connectParams = JSON.parse(localStorage.getItem("autoconnect"));
			this.state.connectParams = {
				...this.state.connectParams,
				...connectParams,
				autoconnect: true,
			};
		} else {
			var params = parseQueryString();

			var host = window.location.host || "localhost:8080";
			var proto = "wss:";
			if (window.location.protocol != "https:") {
				proto = "ws:";
			}

			var serverURL;
			if (params.server) {
				if (params.server.startsWith("/")) {
					serverURL = proto + "//" + host + params.server;
				} else {
					serverURL = params.server;
				}
			} else {
				serverURL = proto + "//" + host + "/socket";
			}
			this.state.connectParams.serverURL = serverURL;

			if (params.channels) {
				this.state.connectParams.autojoin = params.channels.split(",");
			}
		}

		if (window.localStorage && localStorage.getItem("receipts")) {
			var obj = JSON.parse(localStorage.getItem("receipts"));
			this.receipts = new Map(Object.entries(obj));
		}
	}

	dismissError(event) {
		event.preventDefault();
		this.setState({ error: null });
	}

	setBufferState(name, updater, callback) {
		this.setState((state) => {
			var buf = state.buffers.get(name);
			if (!buf) {
				return;
			}

			var updated;
			if (typeof updater === "function") {
				updated = updater(buf, state);
			} else {
				updated = updater;
			}
			if (buf === updated || !updated) {
				return;
			}
			updated = { ...buf, ...updated };

			var buffers = new Map(state.buffers);
			buffers.set(name, updated);
			return { buffers };
		}, callback);
	}

	createBuffer(name) {
		this.setState((state) => {
			if (state.buffers.get(name)) {
				return;
			}

			var type;
			if (name == SERVER_BUFFER) {
				type = BufferType.SERVER;
			} else if (this.isChannel(name)) {
				type = BufferType.CHANNEL;
			} else {
				type = BufferType.NICK;
			}

			var bufferList = Array.from(state.buffers.values());
			bufferList.push({
				name,
				type,
				serverInfo: null, // if server
				topic: null, // if channel
				members: new Map(), // if channel
				who: null, // if nick
				offline: false, // if nick
				messages: [],
				unread: Unread.NONE,
			});
			bufferList = bufferList.sort(compareBuffers);
			var buffers = new Map(bufferList.map((buf) => [buf.name, buf]));
			return { buffers };
		});
	}

	switchBuffer(name) {
		var lastReadReceipt = this.getReceipt(name, ReceiptType.READ);
		// TODO: only mark as read if user scrolled at the bottom
		this.setBufferState(name, {
			unread: Unread.NONE,
			lastReadReceipt,
		});
		this.setState({ activeBuffer: name }, () => {
			if (this.composer.current) {
				this.composer.current.focus();
			}

			var buf = this.state.buffers.get(name);
			if (!buf || buf.messages.length == 0) {
				return;
			}
			var lastMsg = buf.messages[buf.messages.length - 1];
			this.setReceipt(name, ReceiptType.READ, lastMsg);
		});
	}

	saveReceipts() {
		if (window.localStorage) {
			var obj = Object.fromEntries(this.receipts);
			localStorage.setItem("receipts", JSON.stringify(obj));
		}
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

	addMessage(bufName, msg) {
		msg.key = messagesCount;
		messagesCount++;

		msg.isHighlight = irc.isHighlight(msg, this.client.nick);

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
			} else if (target == this.client.nick) {
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
					this.switchBuffer(target);
				});
			}
		}

		if (msg.prefix.name != this.client.nick && (msg.command != "PART" && msg.comand != "QUIT")) {
			this.createBuffer(bufName);
		}

		this.setReceipt(bufName, ReceiptType.DELIVERED, msg);

		this.setBufferState(bufName, (buf, state) => {
			// TODO: set unread if scrolled up
			var unread = buf.unread;
			var lastReadReceipt = buf.lastReadReceipt;
			if (state.activeBuffer != buf.name) {
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
		this.setState({ status: Status.CONNECTING, connectParams: params });

		this.client = new Client({
			url: params.serverURL,
			pass: params.serverPass,
			nick: params.nick,
			username: params.username,
			realname: params.realname,
			saslPlain: params.saslPlain,
		});

		this.client.addEventListener("close", () => {
			this.setState({
				status: Status.DISCONNECTED,
				buffers: new Map(),
				activeBuffer: null,
			});
		});

		this.client.addEventListener("message", (event) => {
			this.handleMessage(event.detail.message);
		});

		this.client.addEventListener("error", (event) => {
			this.setState({
				error: event.detail,
			});
		});

		this.createBuffer(SERVER_BUFFER);
		this.switchBuffer(SERVER_BUFFER);
	}

	handleMessage(msg) {
		switch (msg.command) {
		case irc.RPL_WELCOME:
			this.setState({ status: Status.REGISTERED });

			if (this.state.connectParams.autojoin.length > 0) {
				this.client.send({
					command: "JOIN",
					params: [this.state.connectParams.autojoin.join(",")],
				});
			}
			break;
		case irc.RPL_MYINFO:
			// TODO: parse available modes
			var serverInfo = {
				name: msg.params[1],
				version: msg.params[2],
			};
			this.setBufferState(SERVER_BUFFER, { serverInfo });
			break;
		case irc.RPL_NOTOPIC:
			var channel = msg.params[1];

			this.setBufferState(channel, { topic: null });
			break;
		case irc.RPL_TOPIC:
			var channel = msg.params[1];
			var topic = msg.params[2];

			this.setBufferState(channel, { topic });
			break;
		case irc.RPL_TOPICWHOTIME:
			// Ignore
			break;
		case irc.RPL_NAMREPLY:
			var channel = msg.params[2];
			var membersList = msg.params[3].split(" ");

			this.setBufferState(channel, (buf) => {
				var members = new Map(buf.members);
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

			this.setBufferState(who.nick, { who, offline: false });
			break;
		case irc.RPL_ENDOFWHO:
			var target = msg.params[1];
			if (!this.isChannel(target) && target.indexOf("*") < 0) {
				// Not a channel nor a mask, likely a nick
				this.setBufferState(target, (buf) => {
					// TODO: mark user offline if we have old WHO info but this
					// WHO reply is empty
					if (buf.who) {
						return;
					}
					return { offline: true };
				});
			}
			break;
		case "NOTICE":
		case "PRIVMSG":
			var target = msg.params[0];
			if (target == this.client.nick) {
				target = msg.prefix.name;
			}
			this.addMessage(target, msg);
			break;
		case "JOIN":
			var channel = msg.params[0];

			this.createBuffer(channel);
			this.setBufferState(channel, (buf) => {
				var members = new Map(buf.members);
				members.set(msg.prefix.name, null);
				return { members };
			});
			if (msg.prefix.name != this.client.nick) {
				this.addMessage(channel, msg);
			}
			if (channel == this.state.connectParams.autojoin[0]) {
				// TODO: only switch once right after connect
				this.switchBuffer(channel);
			}

			var receipt = this.getReceipt(channel, ReceiptType.READ);
			if (msg.prefix.name == this.client.nick && receipt && this.client.enabledCaps["draft/chathistory"] && this.client.enabledCaps["server-time"]) {
				var after = receipt;
				var before = { time: msg.tags.time || irc.formatDate(new Date()) };
				this.fetchHistoryBetween(channel, after, before, CHATHISTORY_MAX_SIZE).catch((err) => {
					this.setState({ error: "Failed to fetch history: " + err });
					this.receipts.delete(channel);
					this.saveReceipts();
				});
			}
			break;
		case "PART":
			var channel = msg.params[0];

			this.setBufferState(channel, (buf) => {
				var members = new Map(buf.members);
				members.delete(msg.prefix.name);
				return { members };
			});
			this.addMessage(channel, msg);

			if (msg.prefix.name == this.client.nick) {
				this.receipts.delete(channel);
				this.saveReceipts();
			}
			break;
		case "QUIT":
			var affectedBuffers = [];
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				state.buffers.forEach((buf) => {
					if (!buf.members.has(msg.prefix.name) && buf.name != msg.prefix.name) {
						return;
					}
					var members = new Map(buf.members);
					members.delete(msg.prefix.name);
					var offline = buf.name == msg.prefix.name;
					buffers.set(buf.name, { ...buf, members, offline });
					affectedBuffers.push(buf.name);
				});
				return { buffers };
			});
			affectedBuffers.forEach((name) => this.addMessage(name, msg));
			break;
		case "NICK":
			var newNick = msg.params[0];

			var affectedBuffers = [];
			this.setState((state) => {
				var buffers = new Map(state.buffers);
				state.buffers.forEach((buf) => {
					if (!buf.members.has(msg.prefix.name)) {
						return;
					}
					var members = new Map(buf.members);
					members.set(newNick, members.get(msg.prefix.name));
					members.delete(msg.prefix.name);
					buffers.set(buf.name, { ...buf, members });
					affectedBuffers.push(buf.name);
				});
				return { buffers };
			});
			affectedBuffers.forEach((name) => this.addMessage(name, msg));
			break;
		case "TOPIC":
			var channel = msg.params[0];
			var topic = msg.params[1];

			this.setBufferState(channel, { topic });
			this.addMessage(channel, msg);
			break;
		case "AWAY":
			var awayMessage = msg.params[0];

			this.setBufferState(msg.prefix.name, (buf) => {
				var who = { ...buf.who, away: !!awayMessage };
				return { who };
			});
			break;
		case "CAP":
		case "AUTHENTICATE":
		case "PING":
		case "BATCH":
			// Ignore these
			break;
		default:
			this.addMessage(SERVER_BUFFER, msg);
		}
	}

	handleConnectSubmit(connectParams) {
		this.setState({ error: null });

		if (window.localStorage) {
			if (connectParams.autoconnect) {
				localStorage.setItem("autoconnect", JSON.stringify(connectParams));
			} else {
				localStorage.removeItem("autoconnect");
			}
		}

		this.connect(connectParams);
	}

	handleNickClick(nick) {
		this.open(nick);
	}

	isChannel(name) {
		// TODO: use the ISUPPORT token if available
		return irc.STD_CHANNEL_TYPES.indexOf(name[0]) >= 0;
	}

	open(target) {
		if (this.isChannel(target)) {
			this.client.send({ command: "JOIN", params: [target] });
		} else {
			this.client.send({ command: "WHO", params: [target] });
		}
		this.createBuffer(target);
		this.switchBuffer(target);
	}

	close(target) {
		if (target == SERVER_BUFFER) {
			this.client.close();
			return;
		}

		if (this.isChannel(target)) {
			this.client.send({ command: "PART", params: [target] });
		}

		this.switchBuffer(SERVER_BUFFER);
		this.setState((state) => {
			var buffers = new Map(state.buffers);
			buffers.delete(target);
			return { buffers };
		});

		this.receipts.delete(target);
		this.saveReceipts();
	}

	executeCommand(s) {
		var parts = s.split(" ");
		var name = parts[0].toLowerCase().slice(1);
		var args = parts.slice(1);

		var cmd = commands[name];
		if (!cmd) {
			this.setState({ error: "Unknown command '" + name + "'" });
			return;
		}

		try {
			cmd(this, args);
		} catch (error) {
			this.setState({ error });
		}
	}

	privmsg(target, text) {
		if (target == SERVER_BUFFER) {
			this.setState({ error: "Cannot send message in server buffer" });
			return;
		}

		var msg = { command: "PRIVMSG", params: [target, text] };
		this.client.send(msg);

		if (!this.client.enabledCaps["echo-message"]) {
			msg.prefix = { name: this.client.nick };
			this.addMessage(target, msg);
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

		var target = this.state.activeBuffer;
		if (!target) {
			return;
		}

		this.privmsg(target, text);
	}

	handleBufferListClick(name) {
		this.switchBuffer(name);
	}

	handleJoinClick(event) {
		event.preventDefault();

		var channel = prompt("Join channel:");
		if (!channel) {
			return;
		}
		this.client.send({ command: "JOIN", params: [channel] });
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

		if (!this.state.activeBuffer) {
			return null;
		}
		var buf = this.state.buffers.get(this.state.activeBuffer);
		return fromList(buf.members.keys(), prefix);
	}

	roundtripChatHistory(params) {
		// Don't send multiple CHATHISTORY commands in parallel, we can't
		// properly handle batches and errors.
		this.pendingHistory = this.pendingHistory.catch(() => {}).then(() => {
			var msg = {
				command: "CHATHISTORY",
				params,
			};
			return this.client.roundtrip(msg, (event) => {
				var msg = event.detail.message;

				switch (msg.command) {
				case "BATCH":
					var enter = msg.params[0].startsWith("+");
					var name = msg.params[0].slice(1);
					if (enter) {
						break;
					}
					var batch = this.client.batches.get(name);
					if (batch.type == "chathistory") {
						return batch;
					}
					break;
				case "FAIL":
					if (msg.params[0] == "CHATHISTORY") {
						throw msg;
					}
					break;
				}
			});
		});
		return this.pendingHistory;
	}

	/* Fetch history in ascending order */
	fetchHistoryBetween(target, after, before, limit) {
		var max = Math.min(limit, CHATHISTORY_PAGE_SIZE);
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
		});
	}

	handleBufferScrollTop() {
		var target = this.state.activeBuffer;
		if (!target || target == SERVER_BUFFER) {
			return;
		}
		if (!this.client.enabledCaps["draft/chathistory"] || !this.client.enabledCaps["server-time"]) {
			return;
		}
		if (this.endOfHistory.get(target)) {
			return;
		}
		var buf = this.state.buffers.get(target);

		var before;
		if (buf.messages.length > 0) {
			before = buf.messages[0].tags["time"];
		} else {
			before = irc.formatDate(new Date());
		}

		// Avoids sending multiple CHATHISTORY commands in parallel
		this.endOfHistory.set(target, true);

		var params = ["BEFORE", target, "timestamp=" + before, CHATHISTORY_PAGE_SIZE];
		this.roundtripChatHistory(params).then((batch) => {
			this.endOfHistory.set(target, batch.messages.length < CHATHISTORY_PAGE_SIZE);
		});
	}

	componentDidMount() {
		if (this.state.connectParams.autoconnect) {
			this.connect(this.state.connectParams);
		}

		setupKeybindings(this);
	}

	render() {
		if (this.state.status != Status.REGISTERED) {
			return html`
				<section id="connect">
					<${Connect} error=${this.state.error} params=${this.state.connectParams} disabled=${this.state.status != Status.DISCONNECTED} onSubmit=${this.handleConnectSubmit}/>
				</section>
			`;
		}

		var activeBuffer = null;
		if (this.state.activeBuffer) {
			activeBuffer = this.state.buffers.get(this.state.activeBuffer);
		}

		var bufferHeader = null;
		if (activeBuffer) {
			bufferHeader = html`
				<section id="buffer-header">
					<${BufferHeader} buffer=${activeBuffer} onClose=${() => this.close(activeBuffer.name)}/>
				</section>
			`;
		}

		var memberList = null;
		if (activeBuffer && activeBuffer.type == BufferType.CHANNEL) {
			memberList = html`
				<section id="member-list-header">
					${activeBuffer.members.size} users
				</section>
				<section id="member-list">
					<${MemberList} members=${activeBuffer.members} onNickClick=${this.handleNickClick}/>
				</section>
			`;
		}

		return html`
			<section id="buffer-list">
				<${BufferList} buffers=${this.state.buffers} activeBuffer=${this.state.activeBuffer} onBufferClick=${this.handleBufferListClick}/>
				<div class="actions">
					<a href="#" onClick=${this.handleJoinClick}>Join channel</a>
				</div>
			</section>
			${bufferHeader}
			<${ScrollManager} target=${this.buffer} scrollKey=${this.state.activeBuffer} onScrollTop=${this.handleBufferScrollTop}>
				<section id="buffer" ref=${this.buffer}>
					<${Buffer} buffer=${activeBuffer} onNickClick=${this.handleNickClick}/>
				</section>
			</>
			${memberList}
			<${Composer} ref=${this.composer} readOnly=${this.state.activeBuffer == SERVER_BUFFER} onSubmit=${this.handleComposerSubmit} autocomplete=${this.autocomplete}/>
			${this.state.error ? html`
				<p id="error-msg">${this.state.error} <a href="#" onClick=${this.dismissError}>×</a></p>
			` : null}
		`;
	}
}
