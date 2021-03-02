import { html, Component } from "../lib/index.js";
import { getNickURL } from "../state.js";

class MemberItem extends Component {
	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);
	}

	shouldComponentUpdate(nextProps) {
		return this.props.nick !== nextProps.nick;
	}

	handleClick(event) {
		event.preventDefault();
		this.props.onClick();
	}

	render() {
		return html`
			<li>
				<a href=${getNickURL(this.props.nick)} class="nick" onClick=${this.handleClick}>${this.props.nick}</a>
			</li>
		`;
	}
}

export default class MemberList extends Component {
	shouldComponentUpdate(nextProps) {
		return this.props.members !== nextProps.members;
	}

	render() {
		return html`
			<ul>
				${Array.from(this.props.members.entries()).sort().map(([nick, membership]) => html`
					<${MemberItem} key=${nick} nick=${nick} membership=${membership} onClick=${() => this.props.onNickClick(nick)}/>
				`)}
			</ul>
		`;
	}
}
