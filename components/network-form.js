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
		isNew: true,
	};

	constructor(props) {
		super(props);

		this.prevParams = { ...defaultParams };

		this.handleChange = this.handleChange.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		this.state.isNew = !props.params;

		if (props.params) {
			Object.keys(defaultParams).forEach((k) => {
				if (props.params[k] !== undefined) {
					this.state[k] = props.params[k];
					this.prevParams[k] = props.params[k];
				}
			});
		}
	}

	handleChange(event) {
		let target = event.target;
		let value = target.type == "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		let params = {};
		Object.keys(defaultParams).forEach((k) => {
			if (this.prevParams[k] == this.state[k]) {
				return;
			}
			params[k] = this.state[k];
		});

		this.props.onSubmit(params);
	}

	render() {
		let removeNetwork = null;
		if (!this.state.isNew) {
			removeNetwork = html`
				<button type="button" class="danger" onClick=${() => this.props.onRemove()}>
					Remove network
				</button>
			`;
		}

		return html`
			<form onChange=${this.handleChange} onSubmit=${this.handleSubmit}>
				<label>
					Hostname:<br/>
					<input type="text" name="host" value=${this.state.host} autofocus required/>
				</label>
				<br/><br/>

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
					${this.state.isNew ? "Add network" : "Save network"}
				</button>
			</form>
		`;
	}
}
