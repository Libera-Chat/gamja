import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, NetworkStatus, getNetworkName } from "../state.js";

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

	var description = null, actions = null;
	switch (props.buffer.type) {
	case BufferType.SERVER:
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
			} else if (props.buffer.serverInfo) {
				var serverInfo = props.buffer.serverInfo;
				description = `Connected to ${serverInfo.name}`;
			} else {
				description = "Connected";
			}
			break;
		}

		if (props.isBouncer) {
			if (props.network.isupport.get("BOUNCER_NETID")) {
				actions = html`
					<button
						key="join"
						onClick=${handleJoinClick}
					>Join channel</button>
					<button
						key="manage"
						onClick=${handleManageNetworkClick}
					>Manage network</button>
				`;
			} else {
				actions = html`
					<button
						key="add"
						onClick=${handleAddNetworkClick}
					>Add network</button>
					<button
						key="disconnect"
						class="danger"
						onClick=${handleCloseClick}
					>Disconnect</button>
				`;
			}
		} else {
			actions = html`
				<button
					key="join"
					onClick=${handleJoinClick}
				>Join channel</button>
				<button
					key="disconnect"
					class="danger"
					onClick=${handleCloseClick}
				>Disconnect</button>
			`;
		}
		break;
	case BufferType.CHANNEL:
		if (props.buffer.topic) {
			description = linkify(stripANSI(props.buffer.topic), props.onChannelClick);
		}
		actions = html`
			<button
				key="part"
				class="danger"
				onClick=${handleCloseClick}
			>Leave</button>
		`;
		break;
	case BufferType.NICK:
		if (props.buffer.who) {
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

		actions = html`
			<button
				key="close"
				class="danger"
				onClick=${handleCloseClick}
			>Close</button>
		`;
		break;
	}

	var name = props.buffer.name;
	if (props.buffer.type == BufferType.SERVER) {
		name = getNetworkName(props.network, props.bouncerNetwork, props.isBouncer);
	}

	return html`
		<span class="title">${name}</span>
		<span class="description">${description}</span>
		<span class="actions">${actions}</span>
	`;
}
