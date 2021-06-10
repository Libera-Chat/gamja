import * as irc from "../lib/irc.js";
import { html, Component } from "../lib/index.js";
import { BufferType, Unread, getBufferURL, getServerName } from "../state.js";

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	let name = props.buffer.name;
	if (props.buffer.type == BufferType.SERVER) {
		name = getServerName(props.server, props.bouncerNetwork, props.isBouncer);
	}

	let classes = ["type-" + props.buffer.type];
	if (props.active) {
		classes.push("active");
	}
	if (props.buffer.unread != Unread.NONE) {
		classes.push("unread-" + props.buffer.unread);
	}

	return html`
		<li class="${classes.join(" ")}">
			<a href=${getBufferURL(props.buffer)} onClick=${handleClick}>${name}</a>
		</li>
	`;
}


export default function BufferList(props) {
	let items = Array.from(props.buffers.values()).map((buf) => {
		let server = props.servers.get(buf.server);

		let bouncerNetwork = null;
		let bouncerNetID = server.isupport.get("BOUNCER_NETID");
		if (bouncerNetID) {
			bouncerNetwork = props.bouncerNetworks.get(bouncerNetID);
		}

		return html`
			<${BufferItem}
				key=${buf.id}
				buffer=${buf}
				server=${server}
				isBouncer=${props.isBouncer}
				bouncerNetwork=${bouncerNetwork}
				onClick=${() => props.onBufferClick(buf)}
				active=${props.activeBuffer == buf.id}
			/>
		`;
	});

	return html`<ul>${items}</ul>`;
}
