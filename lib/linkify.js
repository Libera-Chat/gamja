import { anchorme, html } from "./index.js";

function linkifyChannel(text, transformChannel) {
	// Don't match punctuation at the end of the channel name
	const channelRegex = /(?:^|\s)(#[^\s]+[^\s.?!…():;,])/gid;

	let children = [];
	let match;
	let last = 0;
	while ((match = channelRegex.exec(text)) !== null) {
		let channel = match[1];
		let [start, end] = match.indices[1];

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

	let links = anchorme.list(text);

	let children = [];
	let last = 0;
	links.forEach((match) => {
		const prefix = text.substring(last, match.start)
		children.push(...linkifyChannel(prefix, transformChannel));

		let proto = match.protocol || "https://";
		if (match.isEmail) {
			proto = "mailto:";
		}

		let url = match.string;
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
