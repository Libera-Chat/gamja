import { html, Component } from "../lib/index.js";
import { BufferType, getBufferURL, getServerName } from "../state.js";

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
		for (let buf of this.props.buffers.values()) {
			if (buf.type === BufferType.SERVER) {
				continue;
			}
			if (query !== "" && !buf.name.toLowerCase().includes(query)) {
				continue;
			}
			l.push(buf);
			if (l.length >= 20) {
				break;
			}
		}
		return l;
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
