export const BufferType = {
	SERVER: "server",
	CHANNEL: "channel",
	NICK: "nick",
};

export const Status = {
	DISCONNECTED: "disconnected",
	CONNECTING: "connecting",
	REGISTERED: "registered",
};

export const Unread = {
	NONE: "",
	MESSAGE: "message",
	HIGHLIGHT: "highlight",

	union: (a, b) => {
		const priority = {
			[Unread.None]: 0,
			[Unread.MESSAGE]: 1,
			[Unread.HIGHLIGHT]: 2,
		};
		return (priority[a] > priority[b]) ? a : b;
	},
};
