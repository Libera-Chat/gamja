import { html, Component } from "../lib/index.js";
import { keybindings } from "../keybindings.js";

function KeyBindingsHelp() {
	var l = keybindings.map((binding) => {
		var keys = [];
		if (binding.ctrlKey) {
			keys.psuh("Ctrl");
		}
		if (binding.altKey) {
			keys.push("Alt");
		}
		keys.push(binding.key);

		keys = keys.map((name, i) => {
			return html`
				${i > 0 ? "+" : null}
				<kbd>${name}</kbd>
			`;
		});

		return html`
			<dt>${keys}</dt>
			<dd>${binding.description}</dd>
		`;
	});

	return html`<dl>${l}</dl>`;
}

export default function Help() {
	return html`
		<h3>Key bindings</h3>
		<${KeyBindingsHelp}/>
	`;
}
