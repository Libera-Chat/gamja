import { html, Component } from "../lib/index.js";
import { strip as stripANSI } from "../lib/ansi.js";
import Membership from "./membership.js";
import * as irc from "../lib/irc.js";

class MemberItem extends Component {
	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);
	}

	shouldComponentUpdate(nextProps) {
		return this.props.nick !== nextProps.nick
			|| this.props.membership !== nextProps.membership
			|| this.props.user !== nextProps.user;
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
		let classes = ["nick"];
		if (user) {
			let mask = "";
			if (user.username && user.hostname) {
				mask = `${user.username}@${user.hostname}`;
			}

			if (irc.isMeaningfulRealname(user.realname, this.props.nick)) {
				title = stripANSI(user.realname);
				if (mask) {
					title = `${title} (${mask})`;
				}
			} else {
				title = mask;
			}

			if (user.account) {
				title += `\nAuthenticated as ${user.account}`;
			}

			if (user.away) {
				classes.push("away");
				title += "\nAway";
			}
		}

		return html`
			<li>
				<a
					href=${irc.formatURL({ entity: this.props.nick, enttype: "user" })}
					class=${classes.join(" ")}
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

	return nickA.localeCompare(nickB);
}

export default class MemberList extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.members !== nextProps.members
			|| this.props.users !== nextProps.users;
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
