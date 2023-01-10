import { html, Component } from "../lib/index.js";

export default class SettingsForm extends Component {
	state = {};

	constructor(props) {
		super(props);

		this.state.secondsInTimestamps = props.settings.secondsInTimestamps;
		this.state.bufferEvents = props.settings.bufferEvents;

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleInput(event) {
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

	registerProtocol() {
		let url = window.location.origin + window.location.pathname + "?open=%s";
		try {
			navigator.registerProtocolHandler("irc", url);
			navigator.registerProtocolHandler("ircs", url);
		} catch (err) {
			console.error("Failed to register protocol handler: ", err);
		}
	}

	render() {
		let protocolHandler = null;
		if (this.props.showProtocolHandler) {
			protocolHandler = html`
				<div class="protocol-handler">
					<div class="left">
						Set gamja as your default IRC client for this browser.
						IRC links will be automatically opened here.
					</div>
					<div class="right">
						<button type="button" onClick=${() => this.registerProtocol()}>
							Enable
						</button>
					</div>
				</div>
				<br/><br/>
			`;
		}

		return html`
			<form onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<label>
					<input
						type="checkbox"
						name="secondsInTimestamps"
						checked=${this.state.secondsInTimestamps}
					/>
					Show seconds in time indicator
				</label>
				<br/><br/>

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

				${protocolHandler}

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
