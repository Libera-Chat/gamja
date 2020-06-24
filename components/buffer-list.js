import { html, Component } from "/lib/index.js";
import { SERVER_BUFFER, Unread } from "/state.js";

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	var name = props.buffer.name;
	if (name == SERVER_BUFFER) {
		name = "server";
	}

	var activeClass = props.active ? "active" : "";

	var unreadClass = "";
	if (props.buffer.unread != Unread.NONE) {
		unreadClass = "unread-" + props.buffer.unread;
	}

	return html`
		<li class="${activeClass} ${unreadClass}">
			<a href="#" onClick=${handleClick}>${name}</a>
		</li>
	`;
}

export default function BufferList(props) {
	return html`
		<ul id="buffer-list">
			${Array.from(this.props.buffers.values()).map(buf => html`
				<${BufferItem} buffer=${buf} onClick=${() => props.onBufferClick(buf.name)} active=${props.activeBuffer == buf.name}/>
			`)}
		</ul>
	`;
}
