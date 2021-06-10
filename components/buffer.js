import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import * as irc from "../lib/irc.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, getNickURL, getChannelURL, getMessageURL } from "../state.js";

function djb2(s) {
	var hash = 5381;
	for (var i = 0; i < s.length; i++) {
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

	var colorIndex = djb2(props.nick) % 16 + 1;
	return html`
		<a href=${getNickURL(props.nick)} class="nick nick-${colorIndex}" onClick=${handleClick}>${props.nick}</a>
	`;
}

function Timestamp({ date, url }) {
	if (!date) {
		return html`<spam class="timestamp">--:--:--</span>`;
	}

	var hh = date.getHours().toString().padStart(2, "0");
	var mm = date.getMinutes().toString().padStart(2, "0");
	var ss = date.getSeconds().toString().padStart(2, "0");
	var timestamp = `${hh}:${mm}:${ss}`;
	return html`
		<a href=${url} class="timestamp" onClick=${(event) => event.preventDefault()}>${timestamp}</a>
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
		var msg = this.props.message;

		var onNickClick = this.props.onNickClick;
		var onChannelClick = this.props.onChannelClick;
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

		var lineClass = "";
		var content;
		switch (msg.command) {
		case "NOTICE":
		case "PRIVMSG":
			var text = msg.params[1];

			var ctcp = irc.parseCTCP(msg);
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
				var prefix = "<", suffix = ">";
				if (msg.command == "NOTICE") {
					prefix = suffix = "-";
				}
				content = html`${prefix}${createNick(msg.prefix.name)}${suffix} ${linkify(stripANSI(text), onChannelClick)}`;
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
			var newNick = msg.params[0];
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
			var topic = msg.params[1];
			content = html`
				${createNick(msg.prefix.name)} changed the topic to: ${linkify(stripANSI(topic), onChannelClick)}
			`;
			break;
		case "INVITE":
			var invitee = msg.params[0];
			var channel = msg.params[1];
			// TODO: instead of checking buffer type, check if invitee is our nick
			if (this.props.buffer.type === BufferType.SERVER) {
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
				<${Timestamp} date=${new Date(msg.tags.time)} url=${getMessageURL(this.props.buffer, msg)}/>
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

	var l = nicks.slice(0, nicks.length - 1).map((nick, i) => {
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
		var msgs = this.props.messages;
		var buf = this.props.buffer;

		var onNickClick = this.props.onNickClick;
		function createNick(nick) {
			return html`
				<${Nick} nick=${nick} onClick=${() => onNickClick(nick)}/>
			`;
		}

		var byCommand = {
			"JOIN": [],
			"PART": [],
			"QUIT": [],
			"NICK": [],
		};
		msgs.forEach((msg) => {
			byCommand[msg.command].push(msg);
		});

		var first = true;
		var content = [];
		["JOIN", "PART", "QUIT"].forEach((cmd) => {
			if (byCommand[cmd].length === 0) {
				return;
			}

			var plural = byCommand[cmd].length > 1;
			var action;
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

			var nicks = byCommand[cmd].map((msg) => msg.prefix.name);

			content.push(createNickList(nicks, createNick));
			content.push(" " + action);
		});

		byCommand["NICK"].forEach((msg) => {
			if (first) {
				first = false;
			} else {
				content.push(", ");
			}

			var newNick = msg.params[0];
			content.push(html`
				${createNick(msg.prefix.name)} is now known as ${createNick(newNick)}
			`);
		});

		var lastMsg = msgs[msgs.length - 1];
		var firstDate = new Date(msgs[0].tags.time);
		var lastDate = new Date(lastMsg.tags.time);
		var timestamp = html`
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
var notificationsSupported = false;
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
		var date = this.props.date;
		var YYYY = date.getFullYear().toString().padStart(4, "0");
		var MM = (date.getMonth() + 1).toString().padStart(2, "0");
		var DD = date.getDate().toString().padStart(2, "0");
		var text = `${YYYY}-${MM}-${DD}`;
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
		var buf = this.props.buffer;
		if (!buf) {
			return null;
		}

		var children = [];
		if (buf.type == BufferType.SERVER) {
			children.push(html`<${NotificationNagger}/>`);
		}

		var onChannelClick = this.props.onChannelClick;
		var onNickClick = this.props.onNickClick;
		function createLogLine(msg) {
			return html`
				<${LogLine}
					key=${"msg-" + msg.key}
					message=${msg}
					buffer=${buf}
					onChannelClick=${onChannelClick}
					onNickClick=${onNickClick}
				/>
			`;
		}
		function createFoldGroup(msgs) {
			// Filter out PART → JOIN pairs
			var partIndexes = new Map();
			var keep = [];
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
					onNickClick=${onNickClick}
				/>
			`;
		}

		var hasUnreadSeparator = false;
		var prevDate = new Date();
		var foldMessages = [];
		buf.messages.forEach((msg) => {
			var sep = [];

			if (!hasUnreadSeparator && buf.type != BufferType.SERVER && buf.lastReadReceipt && msg.tags.time > buf.lastReadReceipt.time) {
				sep.push(html`<${UnreadSeparator} key="unread"/>`);
				hasUnreadSeparator = true;
			}

			var date = new Date(msg.tags.time);
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
