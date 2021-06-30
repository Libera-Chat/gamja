import { html, Component, createRef } from "../lib/index.js";

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

		if (this.props.readOnly && event.target.name === "text" && !event.target.value) {
			event.target.blur();
		}
	}

	handleSubmit(event) {
		event.preventDefault();
		this.props.onSubmit(this.state.text);
		this.setState({ text: "" });
	}

	handleInputKeyDown(event) {
		let input = event.target;

		if (!this.props.autocomplete || event.key !== "Tab") {
			return;
		}

		if (input.selectionStart !== input.selectionEnd) {
			return;
		}

		event.preventDefault();

		let carretIndex = input.selectionStart;
		let text = this.state.text;
		let wordStart;
		for (wordStart = carretIndex - 1; wordStart >= 0; wordStart--) {
			if (text[wordStart] === " ") {
				break;
			}
		}
		wordStart++;

		let wordEnd;
		for (wordEnd = carretIndex; wordEnd < text.length; wordEnd++) {
			if (text[wordEnd] === " ") {
				break;
			}
		}

		let word = text.slice(wordStart, wordEnd);
		if (!word) {
			return;
		}

		let repl = this.props.autocomplete(word);
		if (!repl) {
			return;
		}

		if (wordStart === 0 && wordEnd === text.length) {
			if (word.startsWith("/")) {
				repl += " ";
			} else {
				repl += ": ";
			}
		}

		text = text.slice(0, wordStart) + repl + text.slice(wordEnd);

		input.value = text;
		input.selectionStart = wordStart + repl.length;
		input.selectionEnd = input.selectionStart;

		this.setState({ text });
	}

	handleWindowKeyDown(event) {
		// If an <input> or <button> is focused, ignore.
		if (document.activeElement !== document.body && document.activeElement.tagName !== "SECTION") {
			return;
		}

		// If a modifier is pressed, reserve for key bindings.
		if (event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}

		// Ignore events that don't produce a Unicode string. If the key event
		// result in a character being typed by the user, KeyboardEvent.key
		// will contain the typed string. The key string may contain one
		// Unicode non-control character and multiple Unicode combining
		// characters. String.prototype.length cannot be used since it would
		// return the number of Unicode code-points. Instead, the spread
		// operator is used to count the number of non-combining Unicode
		// characters.
		if ([...event.key].length !== 1) {
			return;
		}

		if (this.state.text) {
			return;
		}

		if (this.props.readOnly && event.key !== "/") {
			return;
		}

		event.preventDefault();
		this.setState({ text: event.key }, () => {
			this.focus();
		});
	}

	componentDidMount() {
		window.addEventListener("keydown", this.handleWindowKeyDown);
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.handleWindowKeyDown);
	}

	focus() {
		if (!this.textInput.current) {
			return;
		}
		document.activeElement.blur(); // in case we're read-only
		this.textInput.current.focus();
	}

	render() {
		let className = "";
		if (this.props.readOnly && !this.state.text) {
			className = "read-only";
		}

		return html`
			<form
				id="composer"
				class=${className}
				onInput=${this.handleInput}
				onSubmit=${this.handleSubmit}
			>
				<input
					type="text"
					name="text"
					ref=${this.textInput}
					value=${this.state.text}
					autocomplete="off"
					placeholder="Type a message"
					enterkeyhint="send"
					onKeyDown=${this.handleInputKeyDown}
				/>
			</form>
		`;
	}
}
