import { html, Component, createRef } from "../lib/index.js";
import linkify from "../lib/linkify.js";

export default class ConnectForm extends Component {
	state = {
		url: "",
		pass: "",
		nick: "",
		password: "",
		rememberMe: false,
		username: "",
		realname: "",
		autojoin: true,
	};
	nickInput = createRef();

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.params) {
			this.state = {
				...this.state,
				url: props.params.url || "",
				nick: props.params.nick || "",
				rememberMe: props.params.autoconnect || false,
				username: props.params.username || "",
				realname: props.params.realname || "",
			};
		}
	}

	handleInput(event) {
		let target = event.target;
		let value = target.type == "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		if (this.props.connecting) {
			return;
		}

		let params = {
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
		} else if (this.props.auth === "external") {
			params.saslExternal = true;
		} else if (this.props.auth === "oauth2") {
			params.saslOauthBearer = this.props.params.saslOauthBearer;
		}

		if (this.state.autojoin) {
			params.autojoin = this.props.params.autojoin || [];
		}

		this.props.onSubmit(params);
	}

	componentDidMount() {
		if (this.nickInput.current) {
			this.nickInput.current.focus();
		}
	}

	render() {
		let disabled = this.props.connecting;

		let serverURL = null;
		if (!this.props.params || !this.props.params.url) {
			serverURL = html`
				<label>
					Server URL:<br/>
					<input
						type="text"
						name="url"
						value=${this.state.url}
						disabled=${disabled}
						inputmode="url"
					/>
				</label>
				<br/><br/>
			`;
		}

		let status = null;
		if (this.props.connecting) {
			status = html`
				<p>Connecting...</p>
			`;
		} else if (this.props.error) {
			status = html`
				<p class="error-text">${linkify(this.props.error)}</p>
			`;
		}

		let auth = null;
		if (this.props.auth !== "disabled" && this.props.auth !== "external" && this.props.auth !== "oauth2") {
			auth = html`
				<label>
					Password:<br/>
					<input
						type="password"
						name="password"
						value=${this.state.password}
						disabled=${disabled}
						required=${this.props.auth === "mandatory"}
						placeholder=${this.props.auth !== "mandatory" ? "(optional)" : ""}
					/>
				</label>
				<br/><br/>
			`;
		}

		let autojoin = null;
		let channels = this.props.params.autojoin || [];
		if (channels.length > 0) {
			let s = channels.length > 1 ? "s" : "";
			autojoin = html`
				<label>
					<input
						type="checkbox"
						name="autojoin"
						checked=${this.state.autojoin}
					/>
					Auto-join channel${s} <strong>${channels.join(", ")}</strong>
				</label>
				<br/><br/>
			`;
		}

		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<h2>Connect to IRC</h2>

				<label>
					Nickname:<br/>
					<input
						type="username"
						name="nick"
						value=${this.state.nick}
						disabled=${disabled}
						ref=${this.nickInput}
						required
						autofocus
					/>
				</label>
				<br/><br/>

				${auth}

				${autojoin}

				<label>
					<input
						type="checkbox"
						name="rememberMe"
						checked=${this.state.rememberMe}
						disabled=${disabled}
					/>
					Remember me
				</label>
				<br/><br/>

				<details>
					<summary role="button">Advanced options</summary>

					<br/>

					${serverURL}

					<label>
						Username:<br/>
						<input
							type="username"
							name="username"
							value=${this.state.username}
							disabled=${disabled}
							placeholder="Same as nickname"
						/>
					</label>
					<br/><br/>

					<label>
						Real name:<br/>
						<input
							type="text"
							name="realname"
							value=${this.state.realname}
							disabled=${disabled}
							placeholder="Same as nickname"
						/>
					</label>
					<br/><br/>

					<label>
						Server password:<br/>
						<input
							type="password"
							name="pass"
							value=${this.state.pass}
							disabled=${disabled}
							placeholder="None"
						/>
					</label>
					<br/><br/>
				</details>

				<br/>
				<button disabled=${disabled}>Connect</button>

				${status}
			</form>
		`;
	}
}
