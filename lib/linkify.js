import { anchorme, html } from "./index.js";

function linkifyChannel(text, transformChannel) {
	var children = [];
	// TODO: Don't match punctuation
	const channelRegex = /(^|\s)(#[^\s]+)/gid;
	let match;

	var last = 0;
	while ((match = channelRegex.exec(text)) !== null) {
		const [_, spaces, channel] = match;

		const start = match.index + spaces.length;
		children.push(text.substring(last, start));
		children.push(transformChannel(channel));

		last = match.index + spaces.length + channel.length;
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
