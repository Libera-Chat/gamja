import { html, Component } from "/lib/index.js";

export default function BufferHeader(props) {
	var topic = null;
	if (props.buffer.topic) {
		topic = html`<span class="topic">${props.buffer.topic}</span>`;
	}

	function handlePartClick(event) {
		event.preventDefault();
		props.onClose();
	}

	return html`
		${topic}
		<span class="actions">
			<a href="#" onClick=${handlePartClick}>Part</a>
		</span>
	`;
}
