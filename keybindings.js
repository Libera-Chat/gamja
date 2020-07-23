import { ReceiptType, Unread } from "/state.js";

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
					buffers.set(buf.name, {
						...buf,
						unread: Unread.NONE,
					});
				});
				return { buffers };
			});
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
