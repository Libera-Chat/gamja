import { html, Component } from "/lib/index.js";

function MemberItem(props) {
	function handleClick(event) {
		event.preventDefault();
		props.onClick();
	}

	var url = "irc:///" + encodeURIComponent(props.nick) + ",isnick";
	return html`
		<li>
			<a href=${url} class="nick" onClick=${handleClick}>${props.nick}</a>
		</li>
	`;
}

export default function MemberList(props) {
	return html`
		<ul id="buffer-list">
			${Array.from(this.props.members.entries()).map(([nick, membership]) => html`
				<${MemberItem} key=${nick} nick=${nick} membership=${membership} onClick=${() => props.onNickClick(nick)}/>
			`)}
		</ul>
	`;
}
