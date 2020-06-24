export const RPL_WELCOME = "001";
export const RPL_TOPIC = "332";
export const RPL_NAMREPLY = "353";
export const RPL_ENDOFNAMES = "366";
export const ERR_PASSWDMISMATCH = "464";
// https://ircv3.net/specs/extensions/sasl-3.1
export const RPL_LOGGEDIN = "900";
export const RPL_LOGGEDOUT = "901";
export const ERR_NICKLOCKED = "902";
export const RPL_SASLSUCCESS = "903";
export const ERR_SASLFAIL = "904";
export const ERR_SASLTOOLONG = "905";
export const ERR_SASLABORTED = "906";
export const ERR_SASLALREADY = "907";

export const STD_CHANNEL_TYPES = "#&+!";

var tagsEscape = {
	";": "\\:",
	" ": "\\s",
	"\\": "\\\\",
	"\r": "\\r",
	"\n": "\\n",
};

function parseTags(s) {
	var tags = {};
	s.split(";").forEach(function(s) {
		if (!s) {
			return;
		}
		var parts = s.split("=", 2);
		if (parts.length != 2) {
			throw new Error("expected an equal sign in tag");
		}
		var k = parts[0];
		var v = parts[1];
		for (var ch in tagsEscape) {
			v = v.replaceAll(tagsEscape[ch], ch);
		}
		if (v.endsWith("\\")) {
			v = v.slice(0, v.length - 1)
		}
		tags[k] = v;
	});
	return tags;
}

function formatTags(tags) {
	var l = [];
	for (var k in tags) {
		var v = tags[k];
		for (var ch in tagsEscape) {
			v = v.replaceAll(ch, tagsEscape[ch]);
		}
		l.push(k + "=" + v);
	}
	return l.join(";");
}

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

export function parseMessage(s) {
	if (s.endsWith("\r\n")) {
		s = s.slice(0, s.length - 2);
	}

	var msg = {
		tags: {},
		prefix: null,
		command: null,
		params: [],
	};

	if (s.startsWith("@")) {
		var i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after tags");
		}
		msg.tags = parseTags(s.slice(1, i));
		s = s.slice(i + 1);
	}

	if (s.startsWith(":")) {
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

export function formatMessage(msg) {
	var s = "";
	// TODO: format tags
	if (msg.tags && Object.keys(msg.tags).length > 0) {
		s += "@" + formatTags(msg.tags) + " ";
	}
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

export function parseMembership(s) {
	// TODO: use the PREFIX token from RPL_ISUPPORT
	const STD_MEMBERSHIPS = "~&@%+";

	var i;
	for (i = 0; i < s.length; i++) {
		if (STD_MEMBERSHIPS.indexOf(s[i]) < 0) {
			break;
		}
	}

	return {
		prefix: s.slice(0, i),
		nick: s.slice(i),
	};
}
