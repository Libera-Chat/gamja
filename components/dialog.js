import { html, Component, createRef } from "../lib/index.js";

export default class Dialog extends Component {
	body = createRef();

	constructor(props) {
		super(props);

		this.handleCloseClick = this.handleCloseClick.bind(this);
		this.handleBackdropClick = this.handleBackdropClick.bind(this);
		this.handleKeyDown = this.handleKeyDown.bind(this);
	}

	dismiss() {
		this.props.onDismiss();
	}

	handleCloseClick(event) {
		event.preventDefault();
		this.dismiss();
	}

	handleBackdropClick(event) {
		if (event.target.className == "dialog") {
			this.dismiss();
		}
	}

	handleKeyDown(event) {
		if (event.key == "Escape") {
			this.dismiss();
		}
	}

	componentDidMount() {
		window.addEventListener("keydown", this.handleKeyDown);

		let autofocus = this.body.current.querySelector("input[autofocus]");
		if (autofocus) {
			autofocus.focus();
		}
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.handleKeyDown);
	}

	render() {
		return html`
			<div class="dialog" onClick=${this.handleBackdropClick}>
				<div class="dialog-body" ref=${this.body}>
					<div class="dialog-header">
						<h2>${this.props.title}</h2>
						<button class="dialog-close" onClick=${this.handleCloseClick}>×</button>
					</div>
					${this.props.children}
				</div>
			</div>
		`;
	}
}
