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

		if (this.props.disabled) {
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
		return html`
			<form onChange=${this.handleChange} onSubmit=${this.handleSubmit}>
				<h2>Connect to IRC</h2>

				<label>
					Nickname:<br/>
					<input type="username" name="nick" value=${this.state.nick} disabled=${this.props.disabled} autofocus required/>
				</label>
				<br/><br/>

				<label>
					Password:<br/>
					<input type="password" name="password" value=${this.state.password} disabled=${this.props.disabled}/>
				</label>
				<br/><br/>

				<label>
					<input type="checkbox" name="rememberMe" checked=${this.state.rememberMe} disabled=${this.props.disabled}/>
					Remember me
				</label>
				<br/><br/>

				<details>
					<summary>Advanced options</summary>

					<br/>

					<label>
						Server URL:<br/>
						<input type="url" name="url" value=${this.state.url} disabled=${this.props.disabled} required/>
					</label>
					<br/><br/>

					<label>
						Username:<br/>
						<input type="username" name="username" value=${this.state.username} disabled=${this.props.disabled} placeholder="Same as nickname"/>
					</label>
					<br/><br/>

					<label>
						Real name:<br/>
						<input type="text" name="realname" value=${this.state.realname} disabled=${this.props.disabled} placeholder="Same as nickname"/>
					</label>
					<br/><br/>

					<label>
						Server password:<br/>
						<input type="text" name="pass" value=${this.state.pass} disabled=${this.props.disabled} placeholder="None"/>
					</label>
					<br/><br/>

					<label>
						Auto-join channels:<br/>
						<input type="text" name="autojoin" value=${this.state.autojoin} disabled=${this.props.disabled} placeholder="Comma-separated list of channels"/>
					</label>
					<br/>
				</details>

				<br/>
				${this.props.error ? html`
					<p class="error-text">${this.props.error || ""}</p>
				` : null}
				<button disabled=${this.props.disabled}>Connect</button>
			</form>
		`;
	}
}
