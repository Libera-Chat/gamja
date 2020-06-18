import * as irc from "/lib/irc.js";
import Client from "/lib/client.js";
import Buffer from "/components/buffer.js";
import BufferList from "/components/buffer-list.js";
import Connect from "/components/connect.js";
import Composer from "/components/composer.js";
import { html, Component, createRef } from "/lib/index.js";

const SERVER_BUFFER = "*";

const DISCONNECTED = "disconnected";
const CONNECTING = "connecting";
const REGISTERED = "registered";

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
			autojoin: [],
		},
		status: DISCONNECTED,
		buffers: new Map(),
		activeBuffer: null,
	};
	composer = createRef();

	constructor(props) {
		super(props);

		this.handleConnectSubmit = this.handleConnectSubmit.bind(this);
		this.handleBufferListClick = this.handleBufferListClick.bind(this);
		this.handleComposerSubmit = this.handleComposerSubmit.bind(this);
	}

	setBufferState(name, updater, callback) {
		this.setState((state) => {
			var buf = state.buffers.get(name);
			if (!buf) {
				return;
			}

			var newBuf = updater(buf);
			if (buf === newBuf || !newBuf) {
				return;
			}

			var buffers = new Map(state.buffers);
			buffers.set(name, newBuf);
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
			});
			return { buffers };
		});
	}

	switchBuffer(name) {
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
		// TODO: set time tag if missing

		this.createBuffer(bufName);
		this.setBufferState(bufName, (buf) => {
			return {
				...buf,
				messages: buf.messages.concat(msg),
			};
		});
	}

	connect(params) {
		this.setState({ status: CONNECTING, connectParams: params });

		this.client = new Client({
			url: params.serverURL,
			pass: params.serverPass,
			nick: params.nick,
			username: params.username,
			realname: params.realname,
			saslPlain: params.saslPlain,
		});

		this.client.addEventListener("close", () => {
			this.setState({ status: DISCONNECTED });
		});

		this.client.addEventListener("message", (event) => {
			this.handleMessage(event.detail.message);
		});

		this.createBuffer(SERVER_BUFFER);
		this.switchBuffer(SERVER_BUFFER);
	}

	disconnect() {
		if (!this.client) {
			return;
		}
		this.client.close();
	}

	handleMessage(msg) {
		switch (msg.command) {
		case irc.RPL_WELCOME:
			this.setState({ status: REGISTERED });

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

			this.setBufferState(channel, (buf) => {
				return { ...buf, topic };
			});
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

				return { ...buf, members };
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
				return { ...buf, members };
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
				return { ...buf, members };
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

			this.setBufferState((buf) => {
				return { ...buf, topic };
			});
			this.addMessage(channel, msg);
			break;
		default:
			this.addMessage(SERVER_BUFFER, msg);
		}
	}

	handleConnectSubmit(connectParams) {
		if (localStorage) {
			if (connectParams.rememberMe) {
				localStorage.setItem("autoconnect", JSON.stringify(connectParams));
			} else {
				localStorage.removeItem("autoconnect");
			}
		}

		this.connect(connectParams);
	}

	executeCommand(s) {
		var parts = s.split(" ");
		var cmd = parts[0].toLowerCase().slice(1);
		var args = parts.slice(1);
		switch (cmd) {
		case "quit":
			if (localStorage) {
				localStorage.removeItem("autoconnect");
			}
			this.disconnect();
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
			// TODO: check whether the buffer is a channel with the ISUPPORT token
			// TODO: part reason
			if (!this.state.activeBuffer || this.state.activeBuffer == SERVER_BUFFER) {
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
		if (localStorage && localStorage.getItem("autoconnect")) {
			var connectParams = JSON.parse(localStorage.getItem("autoconnect"));
			this.connect(connectParams);
		} else {
			var params = parseQueryString();

			var serverURL = params.server;
			if (!serverURL) {
				var host = window.location.host || "localhost:8080";
				var proto = "wss:";
				if (window.location.protocol != "https:") {
					proto = "ws:";
				}
				connectParams.serverURL = proto + "//" + host + "/socket";
			}

			var autojoin = [];
			if (params.channels) {
				autojoin = params.channels.split(",");
			}

			this.setState((state) => {
				return {
					connectParams: {
						...state.connectParams,
						serverURL,
						autojoin,
					},
				};
			});
		}
	}

	render() {
		if (this.state.status != REGISTERED) {
			return html`
				<section id="connect">
					<${Connect} params=${this.state.connectParams} disabled=${this.state.status != DISCONNECTED} onSubmit=${this.handleConnectSubmit}/>
				</section>
			`;
		}

		var activeBuffer = null;
		if (this.state.activeBuffer) {
			activeBuffer = this.state.buffers.get(this.state.activeBuffer);
		}

		return html`
			<section id="sidebar">
				<${BufferList} buffers=${this.state.buffers} activeBuffer=${this.state.activeBuffer} onBufferClick=${this.handleBufferListClick}/>
			</section>
			<section id="buffer">
				<${Buffer} buffer=${activeBuffer}/>
			</section>
			<${Composer} ref=${this.composer} readOnly=${this.state.activeBuffer == SERVER_BUFFER} onSubmit=${this.handleComposerSubmit}/>
		`;
	}
}
