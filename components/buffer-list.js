import { html, Component } from "/lib/index.js";
import { BufferType, Unread, getBufferURL } from "/state.js";

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	var name = props.buffer.name;
	if (props.buffer.type == BufferType.SERVER) {
		name = "server";
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

function compareBuffers(a, b) {
	if (a.type == BufferType.SERVER) {
		return -1;
	}
	if (b.type == BufferType.SERVER) {
		return 1;
	}

	if (a.name > b.name) {
		return -1;
	}
	if (a.name < b.name) {
		return 1;
	}

	return 0;
}

export default function BufferList(props) {
	return html`
		<ul>
			${Array.from(props.buffers.values()).sort(compareBuffers).map(buf => html`
				<${BufferItem} key=${buf.name} buffer=${buf} onClick=${() => props.onBufferClick(buf.name)} active=${props.activeBuffer == buf.name}/>
			`)}
		</ul>
	`;
}
