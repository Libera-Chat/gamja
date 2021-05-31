import { ReceiptType, Unread, BufferType, SERVER_BUFFER } from "./state.js";

function getSiblingBuffer(buffers, bufID, delta) {
	var bufList = Array.from(buffers.values());
	var i = bufList.findIndex((buf) => buf.id === bufID);
	if (i < 0) {
		return null;
	}
	i = (i + bufList.length + delta) % bufList.length;
	return bufList[i];
}

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
			// TODO: order by age if same priority
			var firstServerBuffer = null;
			var target = null;
			for (var buf of app.state.buffers.values()) {
				if (!firstServerBuffer && buf.type === BufferType.SERVER) {
					firstServerBuffer = buf;
				}

				if (buf.unread === Unread.NONE) {
					continue;
				}

				if (!target || Unread.compare(buf.unread, target.unread) > 0) {
					target = buf;
				}
			}
			if (!target) {
				target = firstServerBuffer;
			}
			if (target) {
				app.switchBuffer(target);
			}
		},
	},
	{
		key: "ArrowUp",
		altKey: true,
		description: "Jump to the previous buffer",
		execute: (app) => {
			var prev = getSiblingBuffer(app.state.buffers, app.state.activeBuffer, -1);
			if (prev) {
				app.switchBuffer(prev);
			}
		},
	},
	{
		key: "ArrowDown",
		altKey: true,
		description: "Jump to the next buffer",
		execute: (app) => {
			var next = getSiblingBuffer(app.state.buffers, app.state.activeBuffer, 1);
			if (next) {
				app.switchBuffer(next);
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
