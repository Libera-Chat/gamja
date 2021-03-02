import { html, Component } from "/lib/index.js";
import linkify from "/lib/linkify.js";
import * as irc from "/lib/irc.js";
import { strip as stripANSI } from "/lib/ansi.js";
import { BufferType, getNickURL, getMessageURL } from "/state.js";

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

class LogLine extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.message !== nextProps.message;
	}

	render() {
		var msg = this.props.message;

		function createNick(nick) {
			return html`
				<${Nick} nick=${nick} onClick=${() => props.onNickClick(nick)}/>
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
					content = html`* ${createNick(msg.prefix.name)} ${linkify(stripANSI(ctcp.param))}`;
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
				content = html`${prefix}${createNick(msg.prefix.name)}${suffix} ${linkify(stripANSI(text))}`;
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
		case "TOPIC":
			var topic = msg.params[1];
			content = html`
				${createNick(msg.prefix.name)} changed the topic to: ${linkify(stripANSI(topic))}
			`;
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

class NotificationNagger extends Component {
	state = { nag: false };

	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);

		this.state.nag = this.shouldNag();
	}

	shouldNag() {
		return window.Notification && Notification.permission !== "granted" && Notification.permission !== "denied";
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

		var hasUnreadSeparator = false;
		var prevDate = new Date();
		buf.messages.forEach((msg) => {
			if (!hasUnreadSeparator && buf.type != BufferType.SERVER && buf.lastReadReceipt && msg.tags.time > buf.lastReadReceipt.time) {
				children.push(html`<${UnreadSeparator} key="unread"/>`);
				hasUnreadSeparator = true;
			}

			var date = new Date(msg.tags.time);
			if (!sameDate(prevDate, date)) {
				children.push(html`<${DateSeparator} key=${"date-" + date} date=${date}/>`);
			}
			prevDate = date;

			children.push(html`
				<${LogLine} key=${"msg-" + msg.key} message=${msg} buffer=${buf} onNickClick=${this.props.onNickClick}/>
			`);
		});

		return html`
			<div class="logline-list">
				${children}
			</div>
		`;
	}
}
