import { html, Component } from "../lib/index.js";

export default class SettingsForm extends Component {
	state = {};

	constructor(props) {
		super(props);

		this.state.bufferEvents = props.settings.bufferEvents;

		this.handleChange = this.handleChange.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleChange(event) {
		let target = event.target;
		let value = target.type == "checkbox" ? target.checked : target.value;
		this.setState({ [target.name]: value }, () => {
			this.props.onChange(this.state);
		});
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onClose();
	}

	render() {
		return html`
			<form onChange=${this.handleChange} onSubmit=${this.handleSubmit}>
				<label>
					<input
						type="radio"
						name="bufferEvents"
						value="fold"
						checked=${this.state.bufferEvents === "fold"}
					/>
					Show and fold chat events
				</label>
				<br/>
				<label>
					<input
						type="radio"
						name="bufferEvents"
						value="expand"
						checked=${this.state.bufferEvents === "expand"}
					/>
					Show and expand chat events
				</label>
				<br/>
				<label>
					<input
						type="radio"
						name="bufferEvents"
						value="hide"
						checked=${this.state.bufferEvents === "hide"}
					/>
					Hide chat events
				</label>
				<br/><br/>

				<button type="button" class="danger" onClick=${() => this.props.onDisconnect()}>
					Disconnect
				</button>
				<button>
					Close
				</button>
			</form>
		`;
	}
}
