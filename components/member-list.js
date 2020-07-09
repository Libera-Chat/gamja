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
		<ul>
			${Array.from(props.members.entries()).sort().map(([nick, membership]) => html`
				<${MemberItem} key=${nick} nick=${nick} membership=${membership} onClick=${() => props.onNickClick(nick)}/>
			`)}
		</ul>
	`;
}
