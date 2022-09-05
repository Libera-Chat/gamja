import * as irc from "../lib/irc.js";
import { html, Component } from "../lib/index.js";
import { BufferType, Unread, ServerStatus, getBufferURL, getServerName } from "../state.js";

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}
	function handleMouseDown(event) {
		if (event.button === 1) { // middle click
			event.preventDefault();
			props.onClose();
		}
	}

	let name = props.buffer.name;
	if (props.buffer.type == BufferType.SERVER) {
		name = getServerName(props.server, props.bouncerNetwork);
	}

	let classes = ["type-" + props.buffer.type];
	if (props.active) {
		classes.push("active");
	}
	if (props.buffer.unread != Unread.NONE) {
		classes.push("unread-" + props.buffer.unread);
	}
	if (props.buffer.type === BufferType.SERVER) {
		let isError = props.server.status === ServerStatus.DISCONNECTED;
		if (props.bouncerNetwork && props.bouncerNetwork.error) {
			isError = true;
		}
		if (isError) {
			classes.push("error");
		}
	}

	return html`
		<li class="${classes.join(" ")}">
			<a
				href=${getBufferURL(props.buffer)}
				onClick=${handleClick}
				onMouseDown=${handleMouseDown}
			>${name}</a>
		</li>
	`;
}


export default function BufferList(props) {
	let items = Array.from(props.buffers.values()).map((buf) => {
		let server = props.servers.get(buf.server);

		let bouncerNetwork = null;
		if (server.bouncerNetID) {
			bouncerNetwork = props.bouncerNetworks.get(server.bouncerNetID);
		}

		return html`
			<${BufferItem}
				key=${buf.id}
				buffer=${buf}
				server=${server}
				bouncerNetwork=${bouncerNetwork}
				onClick=${() => props.onBufferClick(buf)}
				onClose=${() => props.onBufferClose(buf)}
				active=${props.activeBuffer == buf.id}
			/>
		`;
	});

	return html`<ul>${items}</ul>`;
}
