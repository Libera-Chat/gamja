import { html, Component } from "/lib/index.js";

function BufferItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	var name = props.buffer.name;
	if (name == "*") {
		name = "server";
	}

	return html`
		<li class=${props.active ? "active" : ""}>
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
