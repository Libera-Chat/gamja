import { html, Component } from "../lib/index.js";

const defaultParams = {
	name: "",
	host: "",
	port: 6697,
	nickname: "",
	username: "",
	realname: "",
	pass: "",
};

export default class NetworkForm extends Component {
	prevParams = null;
	state = {
		...defaultParams,
		autojoin: true,
	};

	constructor(props) {
		super(props);

		this.prevParams = { ...defaultParams };

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.params) {
			Object.keys(defaultParams).forEach((k) => {
				if (props.params[k] !== undefined) {
					this.state[k] = props.params[k];
					this.prevParams[k] = props.params[k];
				}
			});
		}
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type == "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		let params = {};
		Object.keys(defaultParams).forEach((k) => {
			if (!this.props.isNew && this.prevParams[k] == this.state[k]) {
				return;
			}
			if (this.props.isNew && defaultParams[k] == this.state[k]) {
				return;
			}
			params[k] = this.state[k];
		});

		let autojoin = this.state.autojoin ? this.props.autojoin : null;
		this.props.onSubmit(params, autojoin);
	}

	render() {
		let removeNetwork = null;
		if (!this.props.isNew) {
			removeNetwork = html`
				<button type="button" class="danger" onClick=${() => this.props.onRemove()}>
					Remove network
				</button>
			`;
		}

		let autojoin = null;
		if (this.props.autojoin) {
			autojoin = html`
				<label>
					<input
						type="checkbox"
						name="autojoin"
						checked=${this.state.autojoin}
					/>
					Auto-join channel <strong>${this.props.autojoin}</strong>
				</label>
				<br/><br/>
			`;
		}

		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<label>
					Hostname:<br/>
					<input type="text" name="host" value=${this.state.host} autofocus required/>
				</label>
				<br/><br/>

				${autojoin}

				<details>
					<summary role="button">Advanced options</summary>

					<br/>

					<label>
						Port:<br/>
						<input type="number" name="port" value=${this.state.port}/>
					</label>
					<br/><br/>

					<label>
						Network name:<br/>
						<input type="text" name="name" value=${this.state.name}/>
					</label>
					<br/><br/>

					<label>
						Nickname:<br/>
						<input type="username" name="nickname" value=${this.state.nickname}/>
					</label>
					<br/><br/>

					<label>
						Username:<br/>
						<input type="username" name="username" value=${this.state.username}/>
					</label>
					<br/><br/>

					<label>
						Real name:<br/>
						<input type="text" name="realname" value=${this.state.realname}/>
					</label>
					<br/><br/>

					<label>
						Server password:<br/>
						<input type="password" name="pass" value=${this.state.pass} placeholder="None"/>
					</label>
					<br/>
				</details>

				<br/>
				${removeNetwork}
				${" "}
				<button>
					${this.props.isNew ? "Add network" : "Save network"}
				</button>
			</form>
		`;
	}
}
