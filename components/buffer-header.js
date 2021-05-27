import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, NetworkStatus } from "../state.js";

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
	function handleCloseClick(event) {
		event.preventDefault();
		props.onClose();
	}
	function handleJoinClick(event) {
		event.preventDefault();
		props.onJoin();
	}
	function handleAddNetworkClick(event) {
		event.preventDefault();
		props.onAddNetwork();
	}
	function handleManageNetworkClick(event) {
		event.preventDefault();
		props.onManageNetwork();
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
			if (props.bouncerNetwork) {
				switch (props.bouncerNetwork.state) {
				case "disconnected":
					description = "Bouncer disconnected from network";
					break;
				case "connecting":
					description = "Bouncer connecting to network...";
					break;
				case "connected":
					// host can be undefined e.g. when using UNIX domain sockets
					description = `Connected to ${props.bouncerNetwork.host || "network"}`;
					break;
				}
			} else {
				var serverInfo = props.buffer.serverInfo;
				description = `Connected to ${serverInfo.name}`;
			}
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

	var actions = null;
	switch (props.buffer.type) {
	case BufferType.SERVER:
		if (props.isBouncer) {
			if (props.network.isupport.get("BOUNCER_NETID")) {
				actions = html`
					<a href="#" onClick=${handleJoinClick}>Join</a>
					${" "}
					<a href="#" onClick=${handleManageNetworkClick}>Manage network</a>
				`;
			} else {
				actions = html`
					<a href="#" onClick=${handleAddNetworkClick}>Add network</a>
					${" "}
					<a href="#" onClick=${handleCloseClick}>Disconnect</a>
				`;
			}
		} else {
			actions = html`
				<a href="#" onClick=${handleJoinClick}>Join</a>
				${" "}
				<a href="#" onClick=${handleCloseClick}>Disconnect</a>
			`;
		}
		break;
	case BufferType.CHANNEL:
		actions = html`<a href="#" onClick=${handleCloseClick}>Part</a>`;
		break;
	case BufferType.NICK:
		actions = html`<a href="#" onClick=${handleCloseClick}>Close</a>`;
		break;
	}

	return html`
		<span class="description">${description}</span>
		<span class="actions">${actions}</span>
	`;
}
