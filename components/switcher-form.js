import { html, Component } from "../lib/index.js";
import { BufferType, getBufferURL, getServerName } from "../state.js";
import * as irc from "../lib/irc.js";

class SwitcherItem extends Component {
	constructor(props) {
		super(props);

		this.handleClick = this.handleClick.bind(this);
	}

	handleClick(event) {
		event.preventDefault();
		this.props.onClick();
	}

	render() {
		let class_ = this.props.selected ? "selected" : "";

		return html`
			<li>
				<a
					href=${getBufferURL(this.props.buffer)}
					class=${class_}
					onClick=${this.handleClick}
				>
					<span class="server">
						${getServerName(this.props.server, this.props.bouncerNetwork)}
					</span>
					${this.props.buffer.name}
				</a>
			</li>
		`;
	}
}

function matchString(s, query) {
	return s.toLowerCase().includes(query) ? 1 : 0;
}

function matchBuffer(buf, server, query) {
	let score = 2 * matchString(buf.name, query);
	switch (buf.type) {
	case BufferType.CHANNEL:
		score += matchString(buf.topic || "", query);
		break;
	case BufferType.NICK:
		let user = server.users.get(buf.name);
		if (user && user.realname && irc.isMeaningfulRealname(user.realname, buf.name)) {
			score += matchString(user.realname, query);
		}
		break;
	}
	return score;
}

export default class SwitcherForm extends Component {
	state = {
		query: "",
		selected: 0,
	};

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
		this.handleKeyUp = this.handleKeyUp.bind(this);
	}

	getSuggestions() {
		let query = this.state.query.toLowerCase();

		let l = [];
		let scores = new Map();
		for (let buf of this.props.buffers.values()) {
			if (buf.type === BufferType.SERVER) {
				continue;
			}
			let score = 0;
			if (query !== "") {
				let server = this.props.servers.get(buf.server);
				score = matchBuffer(buf, server, query);
				if (!score) {
					continue;
				}
			}
			scores.set(buf.id, score);
			l.push(buf);
		}

		l.sort((a, b) => {
			return scores.get(b.id) - scores.get(a.id);
		});

		return l.slice(0, 20);
	}

	handleInput(event) {
		let target = event.target;
		this.setState({ [target.name]: target.value });
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onSubmit(this.getSuggestions()[this.state.selected]);
	}

	handleKeyUp(event) {
		switch (event.key) {
		case "ArrowUp":
			event.stopPropagation();
			this.move(-1);
			break;
		case "ArrowDown":
			event.stopPropagation();
			this.move(1);
			break;
		}
	}

	move(delta) {
		let numSuggestions = this.getSuggestions().length;
		this.setState((state) => {
			return {
				selected: (state.selected + delta + numSuggestions) % numSuggestions,
			};
		});
	}

	render() {
		let items = this.getSuggestions().map((buf, i) => {
			let server = this.props.servers.get(buf.server);

			let bouncerNetwork = null;
			if (server.bouncerNetID) {
				bouncerNetwork = this.props.bouncerNetworks.get(server.bouncerNetID);
			}

			return html`
				<${SwitcherItem}
					buffer=${buf}
					server=${server}
					bouncerNetwork=${bouncerNetwork}
					selected=${this.state.selected === i}
					onClick=${() => this.props.onSubmit(buf)}
				/>
			`;
		});

		return html`
			<form
				onInput=${this.handleInput}
				onSubmit=${this.handleSubmit}
				onKeyUp=${this.handleKeyUp}
			>
				<input
					type="search"
					name="query"
					value=${this.state.query}
					placeholder="Filter"
					autocomplete="off"
					autofocus
				/>
				<ul class="switcher-list">
					${items}
				</ul>
			</form>
		`;
	}
}
