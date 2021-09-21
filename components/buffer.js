import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import * as irc from "../lib/irc.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, getNickURL, getChannelURL, getMessageURL } from "../state.js";
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
		<a href=${getNickURL(props.nick)} class="nick nick-${colorIndex}" onClick=${handleClick}>${props.nick}</a>
	`;
}

function Timestamp({ date, url }) {
	if (!date) {
		return html`<spam class="timestamp">--:--:--</span>`;
	}

	let hh = date.getHours().toString().padStart(2, "0");
	let mm = date.getMinutes().toString().padStart(2, "0");
	let ss = date.getSeconds().toString().padStart(2, "0");
	let timestamp = `${hh}:${mm}:${ss}`;
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
		function createNick(nick) {
			return html`
				<${Nick} nick=${nick} onClick=${() => onNickClick(nick)}/>
			`;
		}
		function createChannel(channel) {
			function onClick(event) {
				event.preventDefault();
				onChannelClick(channel);
			}
			return html`
				<a href=${getChannelURL(channel)} onClick=${onClick}>
					${channel}
				</a>
			`;
		}

		let lineClass = "";
		let content;
		let invitee;
		switch (msg.command) {
		case "NOTICE":
		case "PRIVMSG":
			let target = msg.params[0];
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
			let allowedPrefixes = server.isupport.get("STATUSMSG");
			if (target !== buf.name && allowedPrefixes) {
				let parts = irc.parseTargetPrefix(target, allowedPrefixes);
				if (parts.name === buf.name) {
					content = [html`(<${Membership} value=${parts.prefix}/>)`, " ", content];
				}
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
			content = html`
				* ${createNick(msg.prefix.name)} sets mode ${msg.params.slice(1).join(" ")}
			`;
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
		case irc.RPL_INVITING:
			invitee = msg.params[1];
			content = html`${createNick(invitee)} has been invited to the channel`;
			break;
		case irc.RPL_MOTD:
			lineClass = "motd";
			content = linkify(stripANSI(msg.params[1]), onChannelClick);
			break;
		default:
			if (irc.isError(msg.command) && msg.command != irc.ERR_NOMOTD) {
				lineClass = "error";
			}
			content = html`${msg.command} ${msg.params.join(" ")}`;
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

			let plural = byCommand[cmd].length > 1;
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

			let nicks = byCommand[cmd].map((msg) => msg.prefix.name);

			content.push(createNickList(nicks, createNick));
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

class DateSeparator extends Component {
	constructor(props) {
		super(props);
	}

	shouldComponentUpdate(nextProps) {
		return this.props.date.getTime() !== nextProps.date.getTime();
	}

	render() {
		let date = this.props.date;
		let YYYY = date.getFullYear().toString().padStart(4, "0");
		let MM = (date.getMonth() + 1).toString().padStart(2, "0");
		let DD = date.getDate().toString().padStart(2, "0");
		let text = `${YYYY}-${MM}-${DD}`;
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
		return this.props.buffer !== nextProps.buffer;
	}

	render() {
		let buf = this.props.buffer;
		let server = this.props.server;
		if (!buf) {
			return null;
		}

		let children = [];
		if (buf.type == BufferType.SERVER) {
			children.push(html`<${NotificationNagger}/>`);
		}

		let onChannelClick = this.props.onChannelClick;
		let onNickClick = this.props.onNickClick;
		function createLogLine(msg) {
			return html`
				<${LogLine}
					key=${"msg-" + msg.key}
					message=${msg}
					buffer=${buf}
					server=${server}
					onChannelClick=${onChannelClick}
					onNickClick=${onNickClick}
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

			if (!hasUnreadSeparator && buf.type != BufferType.SERVER && buf.prevReadReceipt && msg.tags.time > buf.prevReadReceipt.time) {
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
			if (canFoldMessage(msg)) {
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
