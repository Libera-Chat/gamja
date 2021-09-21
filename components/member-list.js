import { html, Component } from "../lib/index.js";
import { getNickURL } from "../state.js";
import Membership from "./membership.js";

class MemberItem extends Component {
	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);
	}

	shouldComponentUpdate(nextProps) {
		return this.props.nick !== nextProps.nick
			|| this.props.membership !== nextProps.membership;
	}

	handleClick(event) {
		event.preventDefault();
		this.props.onClick();
	}

	render() {
		// XXX: If we were feeling creative we could generate unique colors for
		// each item in ISUPPORT CHANMODES. But I am not feeling creative.
		const membmap = {
			"~": "owner",
			"&": "admin",
			"@": "op",
			"%": "halfop",
			"+": "voice",
		};
		const membclass = membmap[this.props.membership[0]] || "";
		let membership = "";
		if (this.props.membership) {
			membership = html`
				<span class="membership ${membclass}" title=${membclass}>
					${this.props.membership}
				</span>
			`;
		};

		let title = null;
		let user = this.props.user;
		if (user && user.username && user.hostname) {
			title = `${user.username}@${user.hostname}`;
		}

		return html`
			<li>
				<a
					href=${getNickURL(this.props.nick)}
					class="nick"
					title=${title}
					onClick=${this.handleClick}
				>
					<${Membership} value=${this.props.membership}/>
					${this.props.nick}
				</a>
			</li>
		`;
	}
}

function sortMembers(a, b) {
	let [nickA, membA] = a, [nickB, membB] = b;

	const prefixPrivs = ["~", "&", "@", "%", "+"]; // TODO: grab it from ISUPPORT PREFIX
	let i = prefixPrivs.indexOf(membA[0]), j = prefixPrivs.indexOf(membB[0]);
	if (i < 0) {
		i = prefixPrivs.length;
	}
	if (j < 0) {
		j = prefixPrivs.length;
	}
	if (i !== j) {
		return i - j;
	}

	return nickA < nickB ? -1 : 1;
}

export default class MemberList extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.members !== nextProps.members;
	}

	render() {
		return html`
			<ul>
				${Array.from(this.props.members).sort(sortMembers).map(([nick, membership]) => html`
					<${MemberItem}
						key=${nick}
						nick=${nick}
						membership=${membership}
						user=${this.props.users.get(nick)}
						onClick=${() => this.props.onNickClick(nick)}
					/>
				`)}
			</ul>
		`;
	}
}
