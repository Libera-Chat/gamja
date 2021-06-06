import { html, Component } from "../lib/index.js";

export default class ConnectForm extends Component {
	state = {
		url: "",
		pass: "",
		nick: "",
		password: "",
		rememberMe: false,
		username: "",
		realname: "",
		autojoin: "",
	};

	constructor(props) {
		super(props);

		this.handleChange = this.handleChange.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.params) {
			this.state = {
				...this.state,
				url: props.params.url || "",
				nick: props.params.nick || "",
				rememberMe: props.params.autoconnect || false,
				username: props.params.username || "",
				realname: props.params.realname || "",
				autojoin: (props.params.autojoin || []).join(","),
			};
		}
	}

	handleChange(event) {
		var target = event.target;
		var value = target.type == "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		if (this.props.connecting) {
			return;
		}

		var params = {
			url: this.state.url,
			pass: this.state.pass,
			nick: this.state.nick,
			autoconnect: this.state.rememberMe,
			username: this.state.username,
			realname: this.state.realname,
			saslPlain: null,
			autojoin: [],
		};

		if (this.state.password) {
			params.saslPlain = {
				username: params.username || params.nick,
				password: this.state.password,
			};
		}

		this.state.autojoin.split(",").forEach(function(ch) {
			ch = ch.trim();
			if (!ch) {
				return;
			}
			params.autojoin.push(ch);
		});

		this.props.onSubmit(params);
	}

	render() {
		var disabled = this.props.connecting;

		var serverURL = null;
		if (!this.props.params || !this.props.params.url) {
			serverURL = html`
				<label>
					Server URL:<br/>
					<input type="text" name="url" value=${this.state.url} disabled=${disabled} inputmode="url"/>
				</label>
				<br/><br/>
			`;
		}

		var status = null;
		if (this.props.connecting) {
			status = html`
				<p>Connecting...</p>
			`;
		} else if (this.props.error) {
			status = html`
				<p class="error-text">${this.props.error}</p>
			`;
		}

		return html`
			<form onChange=${this.handleChange} onSubmit=${this.handleSubmit}>
				<h2>Connect to IRC</h2>

				<label>
					Nickname:<br/>
					<input type="username" name="nick" value=${this.state.nick} disabled=${disabled} autofocus required/>
				</label>
				<br/><br/>

				<label>
					Password:<br/>
					<input type="password" name="password" value=${this.state.password} disabled=${disabled}/>
				</label>
				<br/><br/>

				<label>
					<input type="checkbox" name="rememberMe" checked=${this.state.rememberMe} disabled=${disabled}/>
					Remember me
				</label>
				<br/><br/>

				<details>
					<summary role="button">Advanced options</summary>

					<br/>

					${serverURL}

					<label>
						Username:<br/>
						<input type="username" name="username" value=${this.state.username} disabled=${disabled} placeholder="Same as nickname"/>
					</label>
					<br/><br/>

					<label>
						Real name:<br/>
						<input type="text" name="realname" value=${this.state.realname} disabled=${disabled} placeholder="Same as nickname"/>
					</label>
					<br/><br/>

					<label>
						Server password:<br/>
						<input type="text" name="pass" value=${this.state.pass} disabled=${disabled} placeholder="None"/>
					</label>
					<br/><br/>

					<label>
						Auto-join channels:<br/>
						<input type="text" name="autojoin" value=${this.state.autojoin} disabled=${disabled} placeholder="Comma-separated list of channels"/>
					</label>
					<br/>
				</details>

				<br/>
				<button disabled=${disabled}>Connect</button>

				${status}
			</form>
		`;
	}
}
