import { html, Component, createRef } from "../lib/index.js";

export default class Composer extends Component {
	state = {
		text: "",
	};
	textInput = createRef();
	lastAutocomplete = null;

	constructor(props) {
		super(props);

		this.handleInput = this.handleInput.bind(this);
		this.handleSubmit = this.handleSubmit.bind(this);
		this.handleInputKeyDown = this.handleInputKeyDown.bind(this);
		this.handleWindowKeyDown = this.handleWindowKeyDown.bind(this);
		this.handleWindowPaste = this.handleWindowPaste.bind(this);
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

		let carretPos = input.selectionStart;
		let text = this.state.text;
		let autocomplete;
		if (this.lastAutocomplete && this.lastAutocomplete.text === text && this.lastAutocomplete.carretPos === carretPos) {
			autocomplete = this.lastAutocomplete;
		} else {
			this.lastAutocomplete = null;

			let wordStart;
			for (wordStart = carretPos - 1; wordStart >= 0; wordStart--) {
				if (text[wordStart] === " ") {
					break;
				}
			}
			wordStart++;

			let wordEnd;
			for (wordEnd = carretPos; wordEnd < text.length; wordEnd++) {
				if (text[wordEnd] === " ") {
					break;
				}
			}

			let word = text.slice(wordStart, wordEnd);
			if (!word) {
				return;
			}

			let replacements = this.props.autocomplete(word);
			if (replacements.length === 0) {
				return;
			}

			autocomplete = {
				text,
				carretPos: input.selectionStart,
				prefix: text.slice(0, wordStart),
				suffix: text.slice(wordEnd),
				replacements,
				replIndex: -1,
			};
		}

		let n = autocomplete.replacements.length;
		if (event.shiftKey) {
			autocomplete.replIndex--;
		} else {
			autocomplete.replIndex++;
		}
		autocomplete.replIndex = (autocomplete.replIndex + n) % n;

		let repl = autocomplete.replacements[autocomplete.replIndex];
		if (!autocomplete.prefix && !autocomplete.suffix) {
			if (repl.startsWith("/")) {
				repl += " ";
			} else {
				repl += ": ";
			}
		}

		autocomplete.text = autocomplete.prefix + repl + autocomplete.suffix;
		autocomplete.carretPos = autocomplete.prefix.length + repl.length;

		input.value = autocomplete.text;
		input.selectionStart = autocomplete.carretPos;
		input.selectionEnd = input.selectionStart;

		this.lastAutocomplete = autocomplete;

		this.setState({ text: autocomplete.text });
	}

	handleWindowKeyDown(event) {
		// If an <input> or <button> is focused, ignore.
		if (document.activeElement && document.activeElement !== document.body) {
			switch (document.activeElement.tagName.toLowerCase()) {
			case "section":
			case "a":
				break;
			default:
				return;
			}
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

		if (this.props.readOnly || (this.props.commandOnly && event.key !== "/")) {
			return;
		}

		event.preventDefault();
		this.setState({ text: event.key }, () => {
			this.focus();
		});
	}

	handleWindowPaste(event) {
		// If an <input> is focused, ignore.
		if (document.activeElement !== document.body && document.activeElement.tagName !== "SECTION") {
			return;
		}

		if (this.props.readOnly) {
			return;
		}

		if (!this.textInput.current) {
			return;
		}

		let text = event.clipboardData.getData("text");

		event.preventDefault();
		event.stopImmediatePropagation();

		this.textInput.current.focus();
		this.textInput.current.setRangeText(text, undefined, undefined, "end");
		this.setState({ text: this.textInput.current.value });
	}

	componentDidMount() {
		window.addEventListener("keydown", this.handleWindowKeyDown);
		window.addEventListener("paste", this.handleWindowPaste);
	}

	componentWillUnmount() {
		window.removeEventListener("keydown", this.handleWindowKeyDown);
		window.removeEventListener("paste", this.handleWindowPaste);
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

		let placeholder = "Type a message";
		if (this.props.commandOnly) {
			placeholder = "Type a command (see /help)";
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
					placeholder=${placeholder}
					enterkeyhint="send"
					onKeyDown=${this.handleInputKeyDown}
					maxlength=${this.props.maxLen}
				/>
			</form>
		`;
	}
}
