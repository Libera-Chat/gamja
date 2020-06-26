import { html, Component } from "/lib/index.js";
import { BufferType } from "/state.js";

export default function BufferHeader(props) {
	function handlePartClick(event) {
		event.preventDefault();
		props.onClose();
	}

	var description = null;
	if (props.buffer.serverInfo) {
		var serverInfo = props.buffer.serverInfo;
		description = `Connected to ${serverInfo.name}`;
	} else if (props.buffer.topic) {
		description = props.buffer.topic;
	} else if (props.buffer.who) {
		var who = props.buffer.who;

		var statusClass = "here";
		var statusText = "User is online";
		if (who.away) {
			statusClass = "gone";
			statusText = "User is away";
		}
		var status = html`<span class="status status-${statusClass}" title=${statusText}>●</span>`;

		description = html`${status} ${who.realname} (${who.username}@${who.hostname})`;
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
		<span class="description">${description}</span>
		<span class="actions">
			<a href="#" onClick=${handlePartClick}>${closeText}</a>
		</span>
	`;
}
