const RPL_WELCOME = "001";

function parsePrefix(s) {
	var prefix = {
		name: null,
		user: null,
		host: null,
	};

	var i = s.indexOf("@");
	if (i < 0) {
		prefix.name = s;
		return prefix;
	}
	prefix.host = s.slice(i + 1);
	s = s.slice(0, i);

	var i = s.indexOf("!");
	if (i < 0) {
		prefix.name = s;
		return prefix;
	}
	prefix.name = s.slice(0, i);
	prefix.user = s.slice(i + 1);
	return prefix;
}

function formatPrefix(prefix) {
	if (!prefix.host) {
		return prefix.name;
	}
	if (!prefix.user) {
		return prefix.name + "@" + prefix.host;
	}
	return prefix.name + "!" + prefix.user + "@" + prefix.host;
}

function parseMessage(s) {
	if (s.endsWith("\r\n")) {
		s = s.slice(0, s.length - 2);
	}

	var msg = {
		prefix: null,
		command: null,
		params: [],
	};

	if (s.startsWith("@")) {
		// TODO: parse tags
	}

	if (s.startsWith(":")) {
		var parts = s.split(" ", 2);
		var i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after prefix");
		}
		msg.prefix = parsePrefix(s.slice(1, i));
		s = s.slice(i + 1);
	}

	var i = s.indexOf(" ");
	if (i < 0) {
		msg.command = s;
		return msg;
	}
	msg.command = s.slice(0, i);
	s = s.slice(i + 1);

	while (true) {
		if (s.startsWith(":")) {
			msg.params.push(s.slice(1));
			break;
		}

		i = s.indexOf(" ");
		if (i < 0) {
			msg.params.push(s);
			break;
		}

		msg.params.push(s.slice(0, i));
		s = s.slice(i + 1);
	}

	return msg;
}

function formatMessage(msg) {
	var s = "";
	// TODO: format tags
	if (msg.prefix) {
		s += ":" + formatPrefix(msg.prefix) + " ";
	}
	s += msg.command;
	if (msg.params && msg.params.length > 0) {
		var last = msg.params[msg.params.length - 1];
		if (msg.params.length > 1) {
			s += " " + msg.params.slice(0, -1).join(" ");
		}
		s += " :" + last;
	}
	s += "\r\n";
	return s;
}
