import { html, Component } from "/lib/index.js";
import linkify from "/lib/linkify.js";
import { strip as stripANSI } from "/lib/ansi.js";
import { BufferType } from "/state.js";

const Status = {
	HERE: "here",
	GONE: "gone",
	OFFLINE: "offline",
};

function NickStatus(props) {
	var textMap = {
		[Status.HERE]: "User is online",
		[Status.GONE]: "User is away",
		[Status.OFFLINE]: "User is offline",
	};
	var text = textMap[props.status];
	return html`<span class="status status-${props.status}" title=${text}>●</span>`;
}

export default function BufferHeader(props) {
	function handlePartClick(event) {
		event.preventDefault();
		props.onClose();
	}

	var description = null;
	if (props.buffer.serverInfo) {
		var serverInfo = props.buffer.serverInfo;
		description = `Connected to ${serverInfo.name}`;
	} else if (props.buffer.topic) {
		description = linkify(stripANSI(props.buffer.topic));
	} else if (props.buffer.who) {
		var who = props.buffer.who;

		var realname = stripANSI(who.realname || "");

		var status = Status.HERE;
		if (who.away) {
			status = Status.GONE;
		}
		if (props.buffer.offline) {
			status = Status.OFFLINE;
		}

		description = html`<${NickStatus} status=${status}/> ${realname} (${who.username}@${who.hostname})`;
	} else if (props.buffer.offline) {
		// User is offline, but we don't have WHO information
		description = html`<${NickStatus} status=${Status.OFFLINE}/> ${props.buffer.name}`;
	}

	var closeText = "Close";
	switch (props.buffer.type) {
	case BufferType.SERVER:
		closeText = "Disconnect";
		break;
	case BufferType.CHANNEL:
		closeText = "Part";
		break;
	}

	return html`
		<span class="description">${description}</span>
		<span class="actions">
			<a href="#" onClick=${handlePartClick}>${closeText}</a>
		</span>
	`;
}
