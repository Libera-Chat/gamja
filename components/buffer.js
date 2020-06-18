import { html, Component } from "/lib/index.js";

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
		// TODO
	}

	var colorIndex = djb2(props.nick) % 16 + 1;
	return html`
		<a href="#" class="nick nick-${colorIndex}" onClick=${handleClick}>${props.nick}</a>
	`;
}

function LogLine(props) {
	var msg = props.message;

	var date = new Date();
	if (msg.tags["time"]) {
		date = new Date(msg.tags["time"]);
	}

	var timestamp = date.toLocaleTimeString(undefined, {
		timeStyle: "short",
		hour12: false,
	});
	var timestampLink = html`
		<a href="#" class="timestamp" onClick=${(event) => event.preventDefault()}>${timestamp}</a>
	`;

	var lineClass = "";
	var content;
	switch (msg.command) {
	case "NOTICE":
	case "PRIVMSG":
		var text = msg.params[1];

		var actionPrefix = "\x01ACTION ";
		if (text.startsWith(actionPrefix) && text.endsWith("\x01")) {
			var action = text.slice(actionPrefix.length, -1);

			lineClass = "me-tell";
			content = html`* <${Nick} nick=${msg.prefix.name}/> ${action}`;
		} else {
			lineClass = "talk";
			content = html`${"<"}<${Nick} nick=${msg.prefix.name}/>${">"} ${text}`;
		}
		break;
	case "JOIN":
		content = html`
			<${Nick} nick=${msg.prefix.name}/> has joined
		`;
		break;
	case "PART":
		content = html`
			<${Nick} nick=${msg.prefix.name}/> has left
		`;
		break;
	case "NICK":
		var newNick = msg.params[0];
		content = html`
			<${Nick} nick=${msg.prefix.name}/> is now known as <${Nick} nick=${newNick}/>
		`;
		break;
	case "TOPIC":
		var topic = msg.params[1];
		content = html`
			<${Nick} nick=${msg.prefix.name}/> changed the topic to: ${topic}
		`;
		break;
	default:
		content = html`${msg.command} ${msg.params.join(" ")}`;
	}

	return html`
		<div class="logline ${lineClass}">${timestampLink} ${content}</div>
	`;
}

export default function Buffer(props) {
	if (!props.buffer) {
		return null;
	}

	return props.buffer.messages.map((msg) => html`<${LogLine} message=${msg}/>`);
}
