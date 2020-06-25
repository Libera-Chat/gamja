import * as irc from "/lib/irc.js";
import Client from "/lib/client.js";
import Buffer from "/components/buffer.js";
import BufferList from "/components/buffer-list.js";
import BufferHeader from "/components/buffer-header.js";
import Connect from "/components/connect.js";
import Composer from "/components/composer.js";
import ScrollManager from "/components/scroll-manager.js";
import { html, Component, createRef } from "/lib/index.js";
import { SERVER_BUFFER, Status, Unread } from "/state.js";

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
	};
	buffer = createRef();
	composer = createRef();

	constructor(props) {
		super(props);

		this.handleConnectSubmit = this.handleConnectSubmit.bind(this);
		this.handleBufferListClick = this.handleBufferListClick.bind(this);
		this.handleComposerSubmit = this.handleComposerSubmit.bind(this);
		this.handleNickClick = this.handleNickClick.bind(this);

		if (window.localStorage && localStorage.getItem("autoconnect")) {
			var connectParams = JSON.parse(localStorage.getItem("autoconnect"));
			this.state.connectParams = {
				...this.state.connectParams,
				...connectParams,
				autoconnect: true,
			};
		} else {
			var params = parseQueryString();

			if (params.server) {
				this.state.connectParams.serverURL = params.server;
			} else {
				var host = window.location.host || "localhost:8080";
				var proto = "wss:";
				if (window.location.protocol != "https:") {
					proto = "ws:";
				}
				this.state.connectParams.serverURL = proto + "//" + host + "/socket";
			}

			if (params.channels) {
				this.state.connectParams.autojoin = params.channels.split(",");
			}
		}
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

			var buffers = new Map(state.buffers);
			buffers.set(name, {
				name: name,
				topic: null,
				members: new Map(),
				messages: [],
				unread: Unread.NONE,
			});
			return { buffers };
		});
	}

	switchBuffer(name) {
		this.setBufferState(name, { unread: Unread.NONE });
		this.setState({ activeBuffer: name }, () => {
			if (this.composer.current) {
				this.composer.current.focus();
			}
		});
	}

	addMessage(bufName, msg) {
		if (!msg.tags) {
			msg.tags = {};
		}
		if (!msg.tags["time"]) {
			// Format the current time according to ISO 8601
			var date = new Date();
			var YYYY = date.getUTCFullYear().toString().padStart(4, "0");
			var MM = (date.getUTCMonth() + 1).toString().padStart(2, "0");
			var DD = date.getUTCDate().toString().padStart(2, "0");
			var hh = date.getUTCHours().toString().padStart(2, "0");
			var mm = date.getUTCMinutes().toString().padStart(2, "0");
			var ss = date.getUTCSeconds().toString().padStart(2, "0");
			var sss = date.getUTCMilliseconds().toString().padStart(3, "0");
			msg.tags["time"] = `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}.${sss}Z`;
		}

		var msgUnread = Unread.NONE;
		if (msg.command == "PRIVMSG" || msg.command == "NOTICE") {
			msgUnread = Unread.MESSAGE;
		}

		if (msg.prefix.name != this.client.nick && msg.command != "PART") {
			this.createBuffer(bufName);
		}

		this.setBufferState(bufName, (buf, state) => {
			var unread = buf.unread;
			if (state.activeBuffer != buf.name) {
				unread = Unread.union(unread, msgUnread);
			}
			return {
				messages: buf.messages.concat(msg),
				unread,
			};
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
		case irc.RPL_TOPIC:
			var channel = msg.params[1];
			var topic = msg.params[2];

			this.setBufferState(channel, { topic });
			break;
		case irc.RPL_NAMREPLY:
			var channel = msg.params[2];
			var membersList = msg.params.slice(3);

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
			break;
		case "PART":
			var channel = msg.params[0];

			this.setBufferState(channel, (buf) => {
				var members = new Map(buf.members);
				members.delete(msg.prefix.name);
				return { members };
			});
			this.addMessage(channel, msg);
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
		case "CAP":
		case "AUTHENTICATE":
			// Ignore these
			break;
		default:
			this.addMessage(SERVER_BUFFER, msg);
		}
	}

	handleConnectSubmit(connectParams) {
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
	}

	executeCommand(s) {
		var parts = s.split(" ");
		var cmd = parts[0].toLowerCase().slice(1);
		var args = parts.slice(1);
		switch (cmd) {
		case "quit":
			if (window.localStorage) {
				localStorage.removeItem("autoconnect");
			}
			this.client.close();
			break;
		case "query":
			var nick = args[0];
			if (!nick) {
				console.error("Missing nickname");
				return;
			}
			this.open(nick);
			break;
		case "close":
			var target = this.state.activeBuffer;
			if (!target || target == SERVER_BUFFER) {
				console.error("Not in a user or channel buffer");
				return;
			}
			this.close(target);
			break;
		case "join":
			var channel = args[0];
			if (!channel) {
				console.error("Missing channel name");
				return;
			}
			this.client.send({ command: "JOIN", params: [channel] });
			break;
		case "part":
			// TODO: part reason
			if (!this.state.activeBuffer || !this.isChannel(this.state.activeBuffer)) {
				console.error("Not in a channel");
				return;
			}
			var channel = this.state.activeBuffer;
			this.client.send({ command: "PART", params: [channel] });
			break;
		case "msg":
			var target = args[0];
			var text = args.slice(1).join(" ");
			this.client.send({ command: "PRIVMSG", params: [target, text] });
			break;
		case "nick":
			var newNick = args[0];
			this.client.send({ command: "NICK", params: [newNick] });
			break;
		case "buffer":
			var name = args[0];
			if (!this.state.buffers.has(name)) {
				console.error("Unknown buffer");
				return;
			}
			this.switchBuffer(name);
			break;
		default:
			console.error("Unknwon command '" + cmd + "'");
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
		if (!target || target == SERVER_BUFFER) {
			return;
		}

		var msg = { command: "PRIVMSG", params: [target, text] };
		this.client.send(msg);
		msg.prefix = { name: this.client.nick };
		this.addMessage(target, msg);
	}

	handleBufferListClick(name) {
		this.switchBuffer(name);
	}

	componentDidMount() {
		if (this.state.connectParams.autoconnect) {
			this.connect(this.state.connectParams);
		}
	}

	render() {
		if (this.state.status != Status.REGISTERED) {
			return html`
				<section id="connect">
					<${Connect} params=${this.state.connectParams} disabled=${this.state.status != Status.DISCONNECTED} onSubmit=${this.handleConnectSubmit}/>
				</section>
			`;
		}

		var activeBuffer = null;
		if (this.state.activeBuffer) {
			activeBuffer = this.state.buffers.get(this.state.activeBuffer);
		}

		var topbar = null;
		if (activeBuffer && this.isChannel(activeBuffer.name)) {
			topbar = html`
				<section id="topbar">
					<${BufferHeader} buffer=${activeBuffer} onClose=${() => this.close(activeBuffer.name)}/>
				</section>
			`;
		}

		return html`
			<section id="sidebar">
				<${BufferList} buffers=${this.state.buffers} activeBuffer=${this.state.activeBuffer} onBufferClick=${this.handleBufferListClick}/>
			</section>
			${topbar}
			<${ScrollManager} target=${this.buffer} scrollKey=${this.state.activeBuffer}>
				<section id="buffer" ref=${this.buffer}>
					<${Buffer} buffer=${activeBuffer} onNickClick=${this.handleNickClick}/>
				</section>
			</>
			<${Composer} ref=${this.composer} readOnly=${this.state.activeBuffer == SERVER_BUFFER} onSubmit=${this.handleComposerSubmit}/>
		`;
	}
}