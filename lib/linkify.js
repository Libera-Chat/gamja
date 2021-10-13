import { linkifyjs, html } from "./index.js";

linkifyjs.options.defaults.defaultProtocol = "https";

linkifyjs.registerCustomProtocol("irc");
linkifyjs.registerCustomProtocol("ircs");

linkifyjs.registerPlugin("ircChannel", ({ scanner, parser, utils }) => {
	const { POUND, DOMAIN, TLD, LOCALHOST, UNDERSCORE, DOT, HYPHEN } = scanner.tokens;
	const START_STATE = parser.start;

	const Channel = utils.createTokenClass("ircChannel", {
		isLink: true,
		toHref() {
			return "irc:///" + this.toString();
		},
	});

	const HASH_STATE = START_STATE.tt(POUND);

	const CHAN_STATE = HASH_STATE.tt(DOMAIN, Channel);
	HASH_STATE.tt(TLD, CHAN_STATE);
	HASH_STATE.tt(LOCALHOST, CHAN_STATE);
	HASH_STATE.tt(POUND, CHAN_STATE);

	CHAN_STATE.tt(UNDERSCORE, CHAN_STATE);
	CHAN_STATE.tt(DOMAIN, CHAN_STATE);
	CHAN_STATE.tt(TLD, CHAN_STATE);
	CHAN_STATE.tt(LOCALHOST, CHAN_STATE);

	const CHAN_DIVIDER_STATE = CHAN_STATE.tt(DOT);

	CHAN_DIVIDER_STATE.tt(UNDERSCORE, CHAN_STATE);
	CHAN_DIVIDER_STATE.tt(DOMAIN, CHAN_STATE);
	CHAN_DIVIDER_STATE.tt(TLD, CHAN_STATE);
	CHAN_DIVIDER_STATE.tt(LOCALHOST, CHAN_STATE);
});

export default function linkify(text, onClick) {
	let links = linkifyjs.find(text);

	let children = [];
	let last = 0;
	links.forEach((match) => {
		if (!match.isLink) {
			return;
		}

		const prefix = text.substring(last, match.start)
		children.push(prefix);

		children.push(html`
			<a
				href=${match.href}
				target="_blank"
				rel="noreferrer noopener"
				onClick=${onClick}
			>${match.value}</a>
		`);

		last = match.end;
	});

	const suffix = text.substring(last)
	children.push(suffix);

	return children;
}
