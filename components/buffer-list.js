import * as irc from "../lib/irc.js";
import { html, Component } from "../lib/index.js";
import { BufferType, Unread, getBufferURL } from "../state.js";

function getNetworkName(network) {
	var bouncerStr = network.isupport.get("BOUNCER");
	if (bouncerStr) {
		var bouncerProps = irc.parseTags(bouncerStr);
		if (bouncerProps["network"]) {
			return bouncerProps["network"];
		}
	}

	var netName = network.isupport.get("NETWORK");
	if (netName) {
		return netName;
	}

	return "server";
}

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	var name = props.buffer.name;
	if (props.buffer.type == BufferType.SERVER) {
		name = getNetworkName(props.network);
	}

	var activeClass = props.active ? "active" : "";

	var unreadClass = "";
	if (props.buffer.unread != Unread.NONE) {
		unreadClass = "unread-" + props.buffer.unread;
	}

	return html`
		<li class="${activeClass} ${unreadClass}">
			<a href=${getBufferURL(props.buffer)} onClick=${handleClick}>${name}</a>
		</li>
	`;
}


export default function BufferList(props) {
	return html`
		<ul>
			${Array.from(props.buffers.values()).map((buf) => html`
				<${BufferItem} key=${buf.id} buffer=${buf} network=${props.networks.get(buf.network)} onClick=${() => props.onBufferClick(buf)} active=${props.activeBuffer == buf.id}/>
			`)}
		</ul>
	`;
}
