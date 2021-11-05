import { html, Component } from "../lib/index.js";
import linkify from "../lib/linkify.js";
import { strip as stripANSI } from "../lib/ansi.js";
import { BufferType, ServerStatus, getServerName } from "../state.js";
import * as irc from "../lib/irc.js";

const UserStatus = {
	HERE: "here",
	GONE: "gone",
	OFFLINE: "offline",
};

function NickStatus(props) {
	let textMap = {
		[UserStatus.HERE]: "User is online",
		[UserStatus.GONE]: "User is away",
		[UserStatus.OFFLINE]: "User is offline",
	};
	let text = textMap[props.status];
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

	let description = null, actions = null;
	switch (props.buffer.type) {
	case BufferType.SERVER:
		switch (props.server.status) {
		case ServerStatus.DISCONNECTED:
			description = "Disconnected";
			break;
		case ServerStatus.CONNECTING:
			description = "Connecting...";
			break;
		case ServerStatus.REGISTERING:
			description = "Logging in...";
			break;
		case ServerStatus.REGISTERED:
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
				let serverInfo = props.buffer.serverInfo;
				description = `Connected to ${serverInfo.name}`;
			} else {
				description = "Connected";
			}
			break;
		}

		if (props.isBouncer) {
			if (props.server.isupport.get("BOUNCER_NETID")) {
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
		if (props.buffer.joined) {
			actions = html`
				<button
					key="part"
					class="danger"
					onClick=${handleCloseClick}
				>Leave</button>
			`;
		} else {
			actions = html`
				<button
					key="join"
					onClick=${handleJoinClick}
				>Join</button>
				<button
					key="part"
					class="danger"
					onClick=${handleCloseClick}
				>Close</button>
			`;
		}
		break;
	case BufferType.NICK:
		if (props.user) {
			let status = UserStatus.HERE;
			if (props.user.offline) {
				status = UserStatus.OFFLINE;
			} else if (props.user.away) {
				status = UserStatus.GONE;
			}

			let realname = props.buffer.name;
			if (irc.isMeaningfulRealname(props.user.realname, props.buffer.name)) {
				realname = stripANSI(props.user.realname || "");
			}

			let details = [];
			if (props.user.username && props.user.hostname) {
				details.push(`${props.user.username}@${props.user.hostname}`);
			}
			if (props.user.account) {
				let desc = `This user is verified and has logged in to the server with the account ${props.user.account}.`;
				let item;
				if (props.user.account === props.buffer.name) {
					item = "authenticated";
				} else {
					item = `authenticated as ${props.user.account}`;
				}
				details.push(html`<abbr title=${desc}>${item}</abbr>`);
			} else if (props.server.isupport.has("MONITOR") && props.server.isupport.has("WHOX")) {
				// If the server supports MONITOR and WHOX, we can faithfully
				// keep user.account up-to-date for user queries
				let desc = "This user has not been verified and is not logged in.";
				details.push(html`<abbr title=${desc}>unauthenticated</abbr>`);
			}
			if (props.user.operator) {
				let desc = "This user is a server operator, they have administrator privileges.";
				details.push(html`<abbr title=${desc}>server operator</abbr>`);
			}
			details = details.map((item, i) => {
				if (i === 0) {
					return item;
				}
				return [", ", item];
			});
			if (details.length > 0) {
				details = ["(", details, ")"];
			}

			description = html`<${NickStatus} status=${status}/> ${realname} ${details}`;
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

	let name = props.buffer.name;
	if (props.buffer.type == BufferType.SERVER) {
		name = getServerName(props.server, props.bouncerNetwork, props.isBouncer);
	}

	return html`
		<div class="title">${name}</div>
		${description ? html`<div class="description">${description}</div>` : null}
		<div class="actions">${actions}</div>
	`;
}
