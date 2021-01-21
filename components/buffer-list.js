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


export default function BufferList(props) {
	return html`
		<ul>
			${Array.from(props.buffers.values()).map((buf) => html`
				<${BufferItem} key=${buf.id} buffer=${buf} onClick=${() => props.onBufferClick(buf.name)} active=${props.activeBuffer == buf.id}/>
			`)}
		</ul>
	`;
}
