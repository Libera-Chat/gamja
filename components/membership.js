import { html, Component } from "../lib/index.js";

// XXX: If we were feeling creative we could generate unique colors for
// each item in ISUPPORT CHANMODES. But I am not feeling creative.
const names = {
	"~": "owner",
	"&": "admin",
	"@": "op",
	"%": "halfop",
	"+": "voice",
};

export default function Membership(props) {
	if (!this.props.value) {
		return null;
	}

	const name = names[this.props.value[0]] || "";
	return html`
		<span class="membership ${name}" title=${name}>
			${this.props.value}
		</span>
	`;
}
