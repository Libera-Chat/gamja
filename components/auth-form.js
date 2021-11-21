import { html, Component } from "../lib/index.js";

export default class NetworkForm extends Component {
	state = {
		username: "",
		password: "",
	};

	constructor(props) {
		super(props);

		this.handleChange = this.handleChange.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);

		if (props.username) {
			this.state.username = props.username;
		}
	}

	handleChange(event) {
		let target = event.target;
		let value = target.type == "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value });
	}

	handleSubmit(event) {
		event.preventDefault();

		this.props.onSubmit(this.state.username, this.state.password);
	}

	render() {
		return html`
			<form onChange=${this.handleChange} onSubmit=${this.handleSubmit}>
				<label>
					Username:<br/>
					<input type="username" name="username" value=${this.state.username} required/>
				</label>
				<br/><br/>

				<label>
					Password:<br/>
					<input type="password" name="password" value=${this.state.password} required autofocus/>
				</label>
				<br/><br/>

				<button>Login</button>
			</form>
		`;
	}
}
