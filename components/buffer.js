import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import * as irc from "../lib/irc.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, ServerStatus, BufferEventsDisplayMode, getMessageURL, isMessageBeforeReceipt, SettingsContext } from "../state.js";
import * as store from "../store.js";
import Membership from "./membership.js";

function djb2(s) {
	let hash = 5381;
	for (let i = 0; i < s.length; i++) {
		hash = (hash << 5) + hash + s.charCodeAt(i);
		hash = hash >>> 0; // convert to uint32
	}
	return hash;
}

function Nick(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	let colorIndex = djb2(props.nick) % 16 + 1;
	return html`
		<a href=${irc.formatURL({ entity: props.nick })} class="nick nick-${colorIndex}" onClick=${handleClick}>${props.nick}</a>
	`;
}

function _Timestamp({ date, url, showSeconds }) {
	if (!date) {
		let timestamp = "--:--";
		if (showSeconds) {
			timestamp += ":--";
		}
		return html`<spam class="timestamp">${timestamp}</span>`;
	}

	let hh = date.getHours().toString().padStart(2, "0");
	let mm = date.getMinutes().toString().padStart(2, "0");
	let timestamp = `${hh}:${mm}`;
	if (showSeconds) {
		let ss = date.getSeconds().toString().padStart(2, "0");
		timestamp += ":" + ss;
	}
	return html`
		<a
			href=${url}
			class="timestamp"
			title=${date.toLocaleString()}
			onClick=${(event) => event.preventDefault()}
		>
			${timestamp}
		</a>
	`;
}

function Timestamp(props) {
	return html`
		<${SettingsContext.Consumer}>
			${(settings) => html`
				<${_Timestamp} ...${props} showSeconds=${settings.secondsInTimestamps}/>
			`}
		</>
	`;
}

/**
 * Check whether a message can be folded.
 *
 * Unimportant and noisy messages that may clutter the discussion should be
 * folded.
 */
function canFoldMessage(msg) {
	switch (msg.command) {
	case "JOIN":
	case "PART":
	case "QUIT":
	case "NICK":
		return true;
	}
	return false;
}

class LogLine extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.message !== nextProps.message;
	}

	render() {
		let msg = this.props.message;
		let buf = this.props.buffer;
		let server = this.props.server;

		let onNickClick = this.props.onNickClick;
		let onChannelClick = this.props.onChannelClick;
		let onVerifyClick = this.props.onVerifyClick;

		function createNick(nick) {
			return html`
				<${Nick} nick=${nick} onClick=${() => onNickClick(nick)}/>
			`;
		}
		function createChannel(channel) {
			return html`
				<a href=${irc.formatURL({ entity: channel })} onClick=${onChannelClick}>
					${channel}
				</a>
			`;
		}

		let lineClass = "";
		let content;
		let invitee, target, account;
		switch (msg.command) {
		case "NOTICE":
		case "PRIVMSG":
			target = msg.params[0];
			let text = msg.params[1];

			let ctcp = irc.parseCTCP(msg);
			if (ctcp) {
				if (ctcp.command == "ACTION") {
					lineClass = "me-tell";
					content = html`* ${createNick(msg.prefix.name)} ${linkify(stripANSI(ctcp.param), onChannelClick)}`;
				} else {
					content = html`
						${createNick(msg.prefix.name)} has sent a CTCP command: ${ctcp.command} ${ctcp.param}
					`;
				}
			} else {
				lineClass = "talk";
				let prefix = "<", suffix = ">";
				if (msg.command == "NOTICE") {
					prefix = suffix = "-";
				}
				content = html`${prefix}${createNick(msg.prefix.name)}${suffix} ${linkify(stripANSI(text), onChannelClick)}`;
			}

			let status = null;
			let allowedPrefixes = server.statusMsg;
			if (target !== buf.name && allowedPrefixes) {
				let parts = irc.parseTargetPrefix(target, allowedPrefixes);
				if (parts.name === buf.name) {
					content = [html`(<${Membership} value=${parts.prefix}/>)`, " ", content];
				}
			}

			if (msg.tags["+draft/channel-context"]) {
				content = html`<em>(only visible to you)</em> ${content}`;
			}

			if (msg.isHighlight) {
				lineClass += " highlight";
			}
			break;
		case "JOIN":
			content = html`
				${createNick(msg.prefix.name)} has joined
			`;
			break;
		case "PART":
			content = html`
				${createNick(msg.prefix.name)} has left
			`;
			break;
		case "QUIT":
			content = html`
				${createNick(msg.prefix.name)} has quit
			`;
			break;
		case "NICK":
			let newNick = msg.params[0];
			content = html`
				${createNick(msg.prefix.name)} is now known as ${createNick(newNick)}
			`;
			break;
		case "KICK":
			content = html`
				${createNick(msg.params[1])} was kicked by ${createNick(msg.prefix.name)} (${msg.params.slice(2)})
			`;
			break;
		case "MODE":
			target = msg.params[0];
			content = html`
				* ${createNick(msg.prefix.name)} sets mode ${msg.params.slice(1).join(" ")}
			`;
			// TODO: case-mapping
			if (buf.name !== target) {
				content = html`${content} on ${target}`;
			}
			break;
		case "TOPIC":
			let topic = msg.params[1];
			content = html`
				${createNick(msg.prefix.name)} changed the topic to: ${linkify(stripANSI(topic), onChannelClick)}
			`;
			break;
		case "INVITE":
			invitee = msg.params[0];
			let channel = msg.params[1];
			// TODO: instead of checking buffer type, check if invitee is our nick
			if (buf.type === BufferType.SERVER) {
				lineClass = "talk";
				content = html`
					You have been invited to ${createChannel(channel)} by ${createNick(msg.prefix.name)}
				`;
			} else {
				content = html`
					${createNick(msg.prefix.name)} has invited ${createNick(invitee)} to the channel
				`;
			}
			break;
		case irc.RPL_WELCOME:
			let nick = msg.params[0];
			content = html`Connected to server, your nickname is ${nick}`;
			break;
		case irc.RPL_INVITING:
			invitee = msg.params[1];
			content = html`${createNick(invitee)} has been invited to the channel`;
			break;
		case irc.RPL_MOTD:
			lineClass = "motd";
			content = linkify(stripANSI(msg.params[1]), onChannelClick);
			break;
		case irc.RPL_LOGGEDIN:
			account = msg.params[2];
			content = html`You are now authenticated as ${account}`;
			break;
		case irc.RPL_LOGGEDOUT:
			content = html`You are now unauthenticated`;
			break;
		case "REGISTER":
			account = msg.params[1];
			let reason = msg.params[2];

			function handleVerifyClick(event) {
				event.preventDefault();
				onVerifyClick(account, reason);
			}

			switch (msg.params[0]) {
			case "SUCCESS":
				content = html`A new account has been created, you are now authenticated as ${account}`;
				break;
			case "VERIFICATION_REQUIRED":
				content = html`A new account has been created, but you need to <a href="#" onClick=${handleVerifyClick}>verify it</a>: ${linkify(reason)}`;
				break;
			}
			break;
		case "VERIFY":
			account = msg.params[1];
			content = html`The new account has been verified, you are now authenticated as ${account}`;
			break;
		case irc.RPL_UMODEIS:
			let mode = msg.params[1];
			if (mode) {
				content = html`Your user mode is ${mode}`;
			} else {
				content = html`You have no user mode`;
			}
			break;
		case irc.RPL_CHANNELMODEIS:
			content = html`Channel mode is ${msg.params.slice(2).join(" ")}`;
			break;
		case irc.RPL_CREATIONTIME:
			let date = new Date(parseInt(msg.params[2], 10) * 1000);
			content = html`Channel was created on ${date.toLocaleString()}`;
			break;
		default:
			if (irc.isError(msg.command) && msg.command != irc.ERR_NOMOTD) {
				lineClass = "error";
			}
			content = html`${msg.command} ${linkify(msg.params.join(" "))}`;
		}

		if (!content) {
			return null;
		}

		return html`
			<div class="logline ${lineClass}" data-key=${msg.key}>
				<${Timestamp} date=${new Date(msg.tags.time)} url=${getMessageURL(buf, msg)}/>
				${" "}
				${content}
			</div>
		`;
	}
}

function createNickList(nicks, createNick) {
	if (nicks.length === 0) {
		return null;
	} else if (nicks.length === 1) {
		return createNick(nicks[0]);
	}

	let l = nicks.slice(0, nicks.length - 1).map((nick, i) => {
		if (i === 0) {
			return createNick(nick);
		} else {
			return [", ", createNick(nick)];
		}
	});

	l.push(" and ");
	l.push(createNick(nicks[nicks.length - 1]));

	return l;
}

class FoldGroup extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.messages[0] !== nextProps.messages[0] ||
			this.props.messages[this.props.messages.length - 1] !== nextProps.messages[nextProps.messages.length - 1];
	}

	render() {
		let msgs = this.props.messages;
		let buf = this.props.buffer;

		let onNickClick = this.props.onNickClick;
		function createNick(nick) {
			return html`
				<${Nick} nick=${nick} onClick=${() => onNickClick(nick)}/>
			`;
		}

		let byCommand = {
			"JOIN": [],
			"PART": [],
			"QUIT": [],
			"NICK": [],
		};
		msgs.forEach((msg) => {
			byCommand[msg.command].push(msg);
		});

		let first = true;
		let content = [];
		["JOIN", "PART", "QUIT"].forEach((cmd) => {
			if (byCommand[cmd].length === 0) {
				return;
			}

			let nicks = new Set(byCommand[cmd].map((msg) => msg.prefix.name));

			let plural = nicks.size > 1;
			let action;
			switch (cmd) {
			case "JOIN":
				action = plural ? "have joined" : "has joined";
				break;
			case "PART":
				action = plural ? "have left" : "has left";
				break;
			case "QUIT":
				action = plural ? "have quit" : "has quit";
				break;
			}

			if (first) {
				first = false;
			} else {
				content.push(", ");
			}

			content.push(createNickList([...nicks], createNick));
			content.push(" " + action);
		});

		byCommand["NICK"].forEach((msg) => {
			if (first) {
				first = false;
			} else {
				content.push(", ");
			}

			let newNick = msg.params[0];
			content.push(html`
				${createNick(msg.prefix.name)} is now known as ${createNick(newNick)}
			`);
		});

		let lastMsg = msgs[msgs.length - 1];
		let firstDate = new Date(msgs[0].tags.time);
		let lastDate = new Date(lastMsg.tags.time);
		let timestamp = html`
			<${Timestamp} date=${firstDate} url=${getMessageURL(buf, msgs[0])}/>
		`;
		if (lastDate - firstDate > 60 * 100) {
			timestamp = [
				timestamp,
				" — ",
				html`
					<${Timestamp} date=${lastDate} url=${getMessageURL(buf, lastMsg)}/>
				`,
			];
		}

		return html`
			<div class="logline" data-key=${msgs[0].key}>
				${timestamp}
				${" "}
				${content}
			</div>
		`;
	}
}

// Workaround for https://bugs.chromium.org/p/chromium/issues/detail?id=481856
let notificationsSupported = false;
if (window.Notification) {
	notificationsSupported = true;
	if (Notification.permission === "default") {
		try {
			new Notification("");
		} catch (err) {
			if (err.name === "TypeError") {
				notificationsSupported = false;
			}
		}
	}
}

class NotificationNagger extends Component {
	state = { nag: false };

	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);

		this.state.nag = this.shouldNag();
	}

	shouldNag() {
		return notificationsSupported && Notification.permission === "default";
	}

	handleClick(event) {
		event.preventDefault();

		Notification.requestPermission((permission) => {
			this.setState({ nag: this.shouldNag() });
		});
	}

	render() {
		if (!this.state.nag) {
			return null;
		}

		return html`
			<div class="logline">
				<${Timestamp}/>
				${" "}
				<a href="#" onClick=${this.handleClick}>Turn on desktop notifications</a> to get notified about new messages
			</div>
		`;
	}
}

class ProtocolHandlerNagger extends Component {
	state = { nag: true };

	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);

		this.state.nag = !store.naggedProtocolHandler.load();
	}

	handleClick(event) {
		event.preventDefault();

		let url = window.location.origin + window.location.pathname + "?open=%s";
		try {
			navigator.registerProtocolHandler("irc", url);
			navigator.registerProtocolHandler("ircs", url);
		} catch (err) {
			console.error("Failed to register protocol handler: ", err);
		}

		store.naggedProtocolHandler.put(true);
		this.setState({ nag: false });
	}

	render() {
		if (!navigator.registerProtocolHandler || !this.state.nag) {
			return null;
		}
		let name = this.props.bouncerName || "this bouncer";
		return html`
			<div class="logline">
				<${Timestamp}/>
				${" "}
				<a href="#" onClick=${this.handleClick}>Register our protocol handler</a> to open IRC links with ${name}
			</div>
		`;
	}
}

function AccountNagger({ server, onAuthClick, onRegisterClick }) {
	let accDesc = "an account on this server";
	if (server.name) {
		accDesc = "a " + server.name + " account";
	}

	function handleAuthClick(event) {
		event.preventDefault();
		onAuthClick();
	}
	function handleRegisterClick(event) {
		event.preventDefault();
		onRegisterClick();
	}

	let msg = [html`
		You are unauthenticated on this server,
		${" "}
		<a href="#" onClick=${handleAuthClick}>login</a>
		${" "}
	`];

	if (server.supportsAccountRegistration) {
		msg.push(html`or <a href="#" onClick=${handleRegisterClick}>register</a> ${accDesc}`);
	} else {
		msg.push(html`if you have ${accDesc}`);
	}

	return html`
		<div class="logline">
			<${Timestamp}/> ${msg}
		</div>
	`;
}

class DateSeparator extends Component {
	constructor(props) {
		super(props);
	}

	shouldComponentUpdate(nextProps) {
		return this.props.date.getTime() !== nextProps.date.getTime();
	}

	render() {
		let date = this.props.date;
		let text = date.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" });
		return html`
			<div class="separator date-separator">
				${text}
			</div>
		`;
	}
}

function UnreadSeparator(props) {
	return html`<div class="separator unread-separator">New messages</div>`;
}

function sameDate(d1, d2) {
	return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export default class Buffer extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.buffer !== nextProps.buffer ||
			this.props.settings !== nextProps.settings;
	}

	render() {
		let buf = this.props.buffer;
		if (!buf) {
			return null;
		}

		let server = this.props.server;
		let bouncerNetwork = this.props.bouncerNetwork;
		let settings = this.props.settings;
		let serverName = server.name;

		let children = [];
		if (buf.type == BufferType.SERVER) {
			children.push(html`<${NotificationNagger}/>`);
		}
		if (buf.type == BufferType.SERVER && server.isBouncer && !server.bouncerNetID) {
			children.push(html`<${ProtocolHandlerNagger} bouncerName=${serverName}/>`);
		}
		if (buf.type == BufferType.SERVER && server.status == ServerStatus.REGISTERED && server.supportsSASLPlain && !server.account) {
			children.push(html`
				<${AccountNagger}
					server=${server}
					onAuthClick=${this.props.onAuthClick}
					onRegisterClick=${this.props.onRegisterClick}
				/>
			`);
		}

		let onChannelClick = this.props.onChannelClick;
		let onNickClick = this.props.onNickClick;
		let onVerifyClick = this.props.onVerifyClick;

		function createLogLine(msg) {
			return html`
				<${LogLine}
					key=${"msg-" + msg.key}
					message=${msg}
					buffer=${buf}
					server=${server}
					onChannelClick=${onChannelClick}
					onNickClick=${onNickClick}
					onVerifyClick=${onVerifyClick}
				/>
			`;
		}
		function createFoldGroup(msgs) {
			// Filter out PART → JOIN pairs
			let partIndexes = new Map();
			let keep = [];
			msgs.forEach((msg, i) => {
				if (msg.command === "PART" || msg.command === "QUIT") {
					partIndexes.set(msg.prefix.name, i);
				}
				if (msg.command === "JOIN" && partIndexes.has(msg.prefix.name)) {
					keep[partIndexes.get(msg.prefix.name)] = false;
					partIndexes.delete(msg.prefix.name);
					keep.push(false);
				} else {
					keep.push(true);
				}
			});
			msgs = msgs.filter((msg, i) => keep[i]);

			if (msgs.length === 0) {
				return null;
			} else if (msgs.length === 1) {
				return createLogLine(msgs[0]);
			}
			return html`
				<${FoldGroup}
					key=${"fold-" + msgs[0].key + "-" + msgs[msgs.length - 1].key}
					messages=${msgs}
					buffer=${buf}
					server=${server}
					onNickClick=${onNickClick}
				/>
			`;
		}

		let hasUnreadSeparator = false;
		let prevDate = new Date();
		let foldMessages = [];
		buf.messages.forEach((msg) => {
			let sep = [];

			if (settings.bufferEvents === BufferEventsDisplayMode.HIDE && canFoldMessage(msg)) {
				return;
			}

			if (!hasUnreadSeparator && buf.type != BufferType.SERVER && !isMessageBeforeReceipt(msg, buf.prevReadReceipt)) {
				sep.push(html`<${UnreadSeparator} key="unread"/>`);
				hasUnreadSeparator = true;
			}

			let date = new Date(msg.tags.time);
			if (!sameDate(prevDate, date)) {
				sep.push(html`<${DateSeparator} key=${"date-" + date} date=${date}/>`);
			}
			prevDate = date;

			if (sep.length > 0) {
				children.push(createFoldGroup(foldMessages));
				children.push(sep);
				foldMessages = [];
			}

			// TODO: consider checking the time difference too
			if (settings.bufferEvents === BufferEventsDisplayMode.FOLD && canFoldMessage(msg)) {
				foldMessages.push(msg);
				return;
			}

			if (foldMessages.length > 0) {
				children.push(createFoldGroup(foldMessages));
				foldMessages = [];
			}

			children.push(createLogLine(msg));
		});
		children.push(createFoldGroup(foldMessages));

		return html`
			<div class="logline-list">
				${children}
			</div>
		`;
	}
}
