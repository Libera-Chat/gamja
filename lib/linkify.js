import { anchorme, html } from "./index.js";

export default function linkify(text) {
	var links = anchorme.list(text);

	var children = [];
	var last = 0;
	links.forEach((match) => {
		children.push(text.substring(last, match.start));

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
	children.push(text.substring(last));

	return children;
}
