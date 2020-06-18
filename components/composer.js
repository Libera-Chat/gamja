import { html, Component, createRef } from "/lib/index.js";

export default class Composer extends Component {
	state = {
		text: "",
	};
	textInput = createRef();

	constructor(props) {
		super(props);

		this.handleChange = this.handleChange.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
		this.handleWindowKeyDown = this.handleWindowKeyDown.bind(this);
	}

	handleChange(event) {
		this.setState({ [event.target.name]: event.target.value });
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onSubmit(this.state.text);
		this.setState({ text: "" });
	}

	handleWindowKeyDown(event) {
		if (document.activeElement == document.body && event.key == "/" && !this.state.text) {
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
			<form id="composer" class="${this.props.readOnly && !this.state.text ? "read-only" : ""}" onChange=${this.handleChange} onSubmit=${this.handleSubmit}>
				<input type="text" name="text" ref=${this.textInput} value=${this.state.text} placeholder="Type a message"/>
			</form>
		`;
	}
}
