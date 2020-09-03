// RFC 1459
export const RPL_WELCOME = "001";
export const RPL_YOURHOST = "002";
export const RPL_CREATED = "003";
export const RPL_MYINFO = "004";
export const RPL_ENDOFWHO = "315";
export const RPL_NOTOPIC = "331";
export const RPL_TOPIC = "332";
export const RPL_TOPICWHOTIME = "333";
export const RPL_WHOREPLY = "352";
export const RPL_NAMREPLY = "353";
export const RPL_ENDOFNAMES = "366";
export const ERR_NOMOTD = "422";
export const ERR_ERRONEUSNICKNAME = "432";
export const ERR_NICKNAMEINUSE = "433";
export const ERR_NICKCOLLISION = "436";
export const ERR_NOPERMFORHOST = "463";
export const ERR_PASSWDMISMATCH = "464";
export const ERR_YOUREBANNEDCREEP = "465";
// RFC 2812
export const ERR_UNAVAILRESOURCE = "437";
// IRCv3 SASL: https://ircv3.net/specs/extensions/sasl-3.1
export const RPL_LOGGEDIN = "900";
export const RPL_LOGGEDOUT = "901";
export const ERR_NICKLOCKED = "902";
export const RPL_SASLSUCCESS = "903";
export const ERR_SASLFAIL = "904";
export const ERR_SASLTOOLONG = "905";
export const ERR_SASLABORTED = "906";
export const ERR_SASLALREADY = "907";

export const STD_CHANNEL_TYPES = "#&+!";

const tagEscapeMap = {
	";": "\\:",
	" ": "\\s",
	"\\": "\\\\",
	"\r": "\\r",
	"\n": "\\n",
};

const tagUnescapeMap = Object.fromEntries(Object.entries(tagEscapeMap).map(([from, to]) => [to, from]));

function escapeTag(s) {
	return s.replace(/[; \\\r\n]/, (ch) => tagEscapeMap[ch]);
}

function unescapeTag(s) {
	return s.replace(/\\[:s\\rn]/, (seq) => tagUnescapeMap[seq]);
}

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
		var v = unescapeTag(parts[1]);
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
		var v = escapeTag(tags[k]);
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

const alphaNum = (() => {
	try {
		return new RegExp(/^\p{L}$/, "u");
	} catch (e) {
		return new RegExp(/^[a-zA-Z0-9]$/, "u");
	}
})();

function isWordBoundary(ch) {
	switch (ch) {
	case "-":
	case "_":
	case "|":
		return false;
	case "\u00A0":
		return true;
	default:
		return !alphaNum.test(ch);
	}
}

export function isHighlight(msg, nick) {
	if (msg.command != "PRIVMSG" && msg.command != "NOTICE") {
		return false;
	}
	if (msg.prefix.name == nick) {
		return false; // Our own messages aren't highlights
	}

	var text = msg.params[1];
	while (true) {
		var i = text.indexOf(nick);
		if (i < 0) {
			return false;
		}

		// Detect word boundaries
		var left = "\x00", right = "\x00";
		if (i > 0) {
			left = text[i - 1];
		}
		if (i < text.length) {
			right = text[i + nick.length];
		}
		if (isWordBoundary(left) && isWordBoundary(right)) {
			return true;
		}

		text = text.slice(i + nick.length);
	}
}

export function isError(cmd) {
	if (cmd >= "400" && cmd <= "568") {
		return true;
	}
	switch (cmd) {
	case ERR_NICKLOCKED:
	case ERR_SASLFAIL:
	case ERR_SASLTOOLONG:
	case ERR_SASLABORTED:
	case ERR_SASLALREADY:
		return true;
	case "FAIL":
		return true;
	default:
		return false;
	}
}

export function formatDate(date) {
	// ISO 8601
	var YYYY = date.getUTCFullYear().toString().padStart(4, "0");
	var MM = (date.getUTCMonth() + 1).toString().padStart(2, "0");
	var DD = date.getUTCDate().toString().padStart(2, "0");
	var hh = date.getUTCHours().toString().padStart(2, "0");
	var mm = date.getUTCMinutes().toString().padStart(2, "0");
	var ss = date.getUTCSeconds().toString().padStart(2, "0");
	var sss = date.getUTCMilliseconds().toString().padStart(3, "0");
	return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}.${sss}Z`;
}

export function parseCTCP(msg) {
	if (msg.command != "PRIVMSG" && msg.command != "NOTICE") {
		return null;
	}

	var text = msg.params[1];
	if (!text.startsWith("\x01")) {
		return null;
	}
	text = text.slice(1);
	if (text.endsWith("\x01")) {
		text = text.slice(0, -1);
	}

	var ctcp;
	var i = text.indexOf(" ");
	if (i >= 0) {
		ctcp = { command: text.slice(0, i), param: text.slice(i + 1) };
	} else {
		ctcp = { command: text, param: "" };
	}
	ctcp.command = ctcp.command.toUpperCase();
	return ctcp;
}
