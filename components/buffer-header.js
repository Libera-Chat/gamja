import { html, Component } from "/lib/index.js";
import linkify from "/lib/linkify.js";
import { strip as stripANSI } from "/lib/ansi.js";
import { BufferType, NetworkStatus } from "/state.js";

const UserStatus = {
	HERE: "here",
	GONE: "gone",
	OFFLINE: "offline",
};

function NickStatus(props) {
	var textMap = {
		[UserStatus.HERE]: "User is online",
		[UserStatus.GONE]: "User is away",
		[UserStatus.OFFLINE]: "User is offline",
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
		switch (props.network.status) {
		case NetworkStatus.DISCONNECTED:
			description = "Disconnected";
			break;
		case NetworkStatus.CONNECTING:
			description = "Connecting...";
			break;
		case NetworkStatus.REGISTERING:
			description = "Logging in...";
			break;
		case NetworkStatus.REGISTERED:
			var serverInfo = props.buffer.serverInfo;
			description = `Connected to ${serverInfo.name}`;
			break;
		}
	} else if (props.buffer.topic) {
		description = linkify(stripANSI(props.buffer.topic));
	} else if (props.buffer.who) {
		var who = props.buffer.who;

		var realname = stripANSI(who.realname || "");

		var status = UserStatus.HERE;
		if (who.away) {
			status = UserStatus.GONE;
		}
		if (props.buffer.offline) {
			status = UserStatus.OFFLINE;
		}

		description = html`<${NickStatus} status=${status}/> ${realname} (${who.username}@${who.hostname})`;
	} else if (props.buffer.offline) {
		// User is offline, but we don't have WHO information
		description = html`<${NickStatus} status=${UserStatus.OFFLINE}/> ${props.buffer.name}`;
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
