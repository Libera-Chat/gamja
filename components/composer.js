import { html, Component, createRef } from "/lib/index.js";

export default class Composer extends Component {
	state = {
		text: "",
	};
	textInput = createRef();

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
		this.handleInputKeyDown = this.handleInputKeyDown.bind(this);
		this.handleWindowKeyDown = this.handleWindowKeyDown.bind(this);
	}

	handleInput(event) {
		this.setState({ [event.target.name]: event.target.value });
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onSubmit(this.state.text);
		this.setState({ text: "" });
	}

	handleInputKeyDown(event) {
		if (!this.props.autocomplete || event.key !== "Tab") {
			return;
		}

		var text = this.state.text;
		var i;
		for (i = text.length - 1; i >= 0; i--) {
			if (text[i] === " ") {
				break;
			}
		}
		var prefix = text.slice(i + 1);
		if (!prefix) {
			return;
		}

		event.preventDefault();

		var repl = this.props.autocomplete(prefix);
		if (!repl) {
			return;
		}

		text = text.slice(0, i + 1) + repl;
		this.setState({ text });
	}

	handleWindowKeyDown(event) {
		if (document.activeElement === document.body && event.key === "/" && !this.state.text) {
			event.preventDefault();
			this.setState({ text: "/" }, () => {
				this.focus();
			});
		}
	}

	componentDidMount() {
		window.addEventListener("keydown", this.handleWindowKeyDown);
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.handleWindowKeyDown);
	}

	focus() {
		document.activeElement.blur(); // in case we're read-only
		this.textInput.current.focus();
	}

	render() {
		return html`
			<form id="composer" class="${this.props.readOnly && !this.state.text ? "read-only" : ""}" onInput=${this.handleInput} onSubmit=${this.handleSubmit}>
				<input type="text" name="text" ref=${this.textInput} value=${this.state.text} placeholder="Type a message" onKeyDown=${this.handleInputKeyDown}/>
			</form>
		`;
	}
}
