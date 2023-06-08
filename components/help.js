import { html, Component } from "../lib/index.js";
import { keybindings } from "../keybindings.js";
import commands from "../commands.js";

function KeyBindingsHelp() {
	let l = keybindings.map((binding) => {
		let keys = [];
		if (binding.ctrlKey) {
			keys.push("Ctrl");
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

	if (!window.matchMedia("(pointer: none)").matches) {
		l.push(html`
			<dt><strong>Middle mouse click</strong></dt>
			<dd>Close buffer</dd>
		`);
	}

	return html`<dl>${l}</dl>`;
}

function CommandsHelp() {
	let l = Object.keys(commands).map((name) => {
		let cmd = commands[name];

		let usage = [html`<strong>/${name}</strong>`];
		if (cmd.usage) {
			usage.push(" " + cmd.usage);
		}

		return html`
			<dt><code>${usage}</code></dt>
			<dd>${cmd.description}</dd>
		`;
	});

	return html`<dl>${l}</dl>`;
}

export default function Help() {
	return html`
		<h3>Key bindings</h3>
		<${KeyBindingsHelp}/>

		<h3>Commands</h3>
		<${CommandsHelp}/>
	`;
}
