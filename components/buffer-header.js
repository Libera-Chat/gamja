import { html, Component } from "/lib/index.js";
import { BufferType } from "/state.js";

export default function BufferHeader(props) {
	function handlePartClick(event) {
		event.preventDefault();
		props.onClose();
	}

	var description = null;
	if (props.buffer.topic) {
		description = html`<span class="description">${props.buffer.topic}</span>`;
	} else if (props.buffer.who) {
		var who = props.buffer.who;
		description = html`<span class="description">${who.realname} (${who.username}@${who.hostname})</span>`;
	}

	var closeText = "Close";
	switch (props.buffer.type) {
	case BufferType.SERVER:
		closeText = "Disconnect";
		break;
	case BufferType.CHANNEL:
		closeText = "Part";
		break;
	}

	return html`
		${description}
		<span class="actions">
			<a href="#" onClick=${handlePartClick}>${closeText}</a>
		</span>
	`;
}
