import { ReceiptType, Unread, BufferType, SERVER_BUFFER, receiptFromMessage } from "./state.js";

function getSiblingBuffer(buffers, bufID, delta) {
	let bufList = Array.from(buffers.values());
	let i = bufList.findIndex((buf) => buf.id === bufID);
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
				let buffers = new Map();
				state.buffers.forEach((buf) => {
					buffers.set(buf.id, {
						...buf,
						unread: Unread.NONE,
						prevReadReceipt: null,
					});

					let receipts = {};
					if (buf.messages.length > 0) {
						let lastMsg = buf.messages[buf.messages.length - 1];
						receipts[ReceiptType.READ] = receiptFromMessage(lastMsg);
					}

					let client = app.clients.get(buf.server);
					app.bufferStore.put({
						name: buf.name,
						server: client.params,
						unread: Unread.NONE,
						receipts,
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
			let firstServerBuffer = null;
			let target = null;
			for (let buf of app.state.buffers.values()) {
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
			let prev = getSiblingBuffer(app.state.buffers, app.state.activeBuffer, -1);
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
			let next = getSiblingBuffer(app.state.buffers, app.state.activeBuffer, 1);
			if (next) {
				app.switchBuffer(next);
			}
		},
	},
	{
		key: "k",
		ctrlKey: true,
		description: "Switch to a buffer",
		execute: (app) => {
			app.openDialog("switch");
		},
	},
];

export function setup(app) {
	let byKey = {};
	keybindings.forEach((binding) => {
		if (!byKey[binding.key]) {
			byKey[binding.key] = [];
		}
		byKey[binding.key].push(binding);
	});

	window.addEventListener("keydown", (event) => {
		let candidates = byKey[event.key];
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
