import * as irc from "../lib/irc.js";
import { html, Component } from "../lib/index.js";
import { BufferType, Unread, getBufferURL } from "../state.js";

function getNetworkName(network, bouncerNetwork, bouncer) {
	if (bouncerNetwork && bouncerNetwork.name) {
		return bouncerNetwork.name;
	}
	if (bouncer) {
		return "bouncer";
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
		name = getNetworkName(props.network, props.bouncerNetwork, props.bouncer);
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
	// TODO: check bouncer-networks cap instead
	var bouncer = props.bouncerNetworks.size > 0;

	var items = Array.from(props.buffers.values()).map((buf) => {
		var network = props.networks.get(buf.network);

		var bouncerNetwork = null;
		var bouncerNetID = network.isupport.get("BOUNCER_NETID");
		if (bouncerNetID) {
			bouncerNetwork = props.bouncerNetworks.get(bouncerNetID);
		}

		return html`
			<${BufferItem} key=${buf.id} buffer=${buf} network=${network} bouncer=${bouncer} bouncerNetwork=${bouncerNetwork} onClick=${() => props.onBufferClick(buf)} active=${props.activeBuffer == buf.id}/>
		`;
	});

	return html`<ul>${items}</ul>`;
}
