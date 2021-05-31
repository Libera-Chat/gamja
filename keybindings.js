import { ReceiptType, Unread, SERVER_BUFFER } from "./state.js";

export const keybindings = [
	{
		key: "h",
		altKey: true,
		description: "Mark all messages as read",
		execute: (app) => {
			app.setState((state) => {
				var buffers = new Map();
				state.buffers.forEach((buf) => {
					if (buf.messages.length > 0) {
						var lastMsg = buf.messages[buf.messages.length - 1];
						app.setReceipt(buf.name, ReceiptType.READ, lastMsg);
					}
					buffers.set(buf.id, {
						...buf,
						unread: Unread.NONE,
					});
				});
				return { buffers };
			});
		},
	},
	{
		key: "a",
		altKey: true,
		description: "Jump to next buffer with activity",
		execute: (app) => {
			// TODO: order by priority, then by age
			var target = { name: SERVER_BUFFER };
			for (var buf of app.state.buffers.values()) {
				if (buf.unread != Unread.NONE) {
					target = buf;
					break;
				}
			}
			app.switchBuffer(target);
		},
	},
	{
		key: "ArrowUp",
		altKey: true,
		description: "Jump to the previous buffer",
		execute: (app) => {
			var prev = null;
			for (var buf of app.state.buffers.values()) {
				if (app.state.activeBuffer == buf.id) {
					if (prev) {
						app.switchBuffer(prev);
					}
					break;
				}
				prev = buf;
			}
		},
	},
	{
		key: "ArrowDown",
		altKey: true,
		description: "Jump to the next buffer",
		execute: (app) => {
			var found = false;
			for (var buf of app.state.buffers.values()) {
				if (found) {
					app.switchBuffer(buf);
					break;
				} else if (app.state.activeBuffer == buf.id) {
					found = true;
				}
			}
		},
	},
];

export function setup(app) {
	var byKey = {};
	keybindings.forEach((binding) => {
		if (!byKey[binding.key]) {
			byKey[binding.key] = [];
		}
		byKey[binding.key].push(binding);
	});

	window.addEventListener("keydown", (event) => {
		var candidates = byKey[event.key];
		if (!candidates) {
			return;
		}
		candidates = candidates.filter((binding) => {
			return !!binding.altKey == event.altKey && !!binding.ctrlKey == event.ctrlKey;
		});
		if (candidates.length != 1) {
			return;
		}
		event.preventDefault();
		candidates[0].execute(app);
	});
}
