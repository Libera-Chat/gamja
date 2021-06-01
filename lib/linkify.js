import { anchorme, html } from "./index.js";

function linkifyChannel(text, transformChannel) {
	var children = [];
	// TODO: Don't match punctuation
	const channelRegex = /(?:^|\s)(#[^\s]+)/gid;
	let match;

	var last = 0;
	while ((match = channelRegex.exec(text)) !== null) {
		var channel = match[1];
		var [start, end] = match.indices[1];

		children.push(text.substring(last, start));
		children.push(transformChannel(channel));

		last = end;
	}
	children.push(text.substring(last));

	return children;
}

export default function linkify(text, onChannelClick) {
	function transformChannel(channel) {
		function onClick(event) {
			event.preventDefault();
			onChannelClick(channel);
		}
		return html`
			<a
				href="irc:///${encodeURIComponent(channel)}"
				onClick=${onClick}
			>${channel}</a>`;
	}

	var links = anchorme.list(text);

	var children = [];
	var last = 0;
	links.forEach((match) => {
		const prefix = text.substring(last, match.start)
		children.push(...linkifyChannel(prefix, transformChannel));

		var proto = match.protocol || "https://";
		if (match.isEmail) {
			proto = "mailto:";
		}

		var url = match.string;
		if (!url.startsWith(proto)) {
			url = proto + url;
		}

		children.push(html`<a href=${url} target="_blank" rel="noreferrer noopener">${match.string}</a>`);

		last = match.end;
	});

	const suffix = text.substring(last)
	children.push(...linkifyChannel(suffix, transformChannel));

	return children;
}
