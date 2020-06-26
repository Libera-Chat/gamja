import { html, Component } from "/lib/index.js";
import { BufferType, Unread } from "/state.js";

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

	var url = "#";
	switch (props.buffer.type) {
	case BufferType.SERVER:
		url = "irc:///";
		break;
	case BufferType.CHANNEL:
		url = "irc:///" + encodeURIComponent(props.buffer.name);
		break;
	case BufferType.NICK:
		url = "irc:///" + encodeURIComponent(props.buffer.name) + ",isnick";
		break;
	}

	return html`
		<li class="${activeClass} ${unreadClass}">
			<a href=${url} onClick=${handleClick}>${name}</a>
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
