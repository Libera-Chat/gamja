// RFC 1459
export const RPL_WELCOME = "001";
export const RPL_YOURHOST = "002";
export const RPL_CREATED = "003";
export const RPL_MYINFO = "004";
export const RPL_ISUPPORT = "005";
export const RPL_WHOISUSER = "311";
export const RPL_WHOISSERVER = "312";
export const RPL_WHOISOPERATOR = "313";
export const RPL_WHOISIDLE = "317";
export const RPL_ENDOFWHOIS = "318";
export const RPL_WHOISCHANNELS = "319";
export const RPL_ENDOFWHO = "315";
export const RPL_NOTOPIC = "331";
export const RPL_TOPIC = "332";
export const RPL_TOPICWHOTIME = "333";
export const RPL_WHOREPLY = "352";
export const RPL_NAMREPLY = "353";
export const RPL_ENDOFNAMES = "366";
export const RPL_BANLIST = "367";
export const RPL_ENDOFBANLIST = "368";
export const RPL_MOTD = "372";
export const RPL_MOTDSTART = "375";
export const RPL_ENDOFMOTD = "376";
export const ERR_NOSUCHNICK = "401";
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

export const STD_MEMBERSHIPS = "~&@%+";
export const STD_CHANNEL_TYPES = "#&+!";
export const STD_CHANMODES = "beI,k,l,imnst";

const tagEscapeMap = {
	";": "\\:",
	" ": "\\s",
	"\\": "\\\\",
	"\r": "\\r",
	"\n": "\\n",
};

const tagUnescapeMap = Object.fromEntries(Object.entries(tagEscapeMap).map(([from, to]) => [to, from]));

function escapeTag(s) {
	return String(s).replace(/[; \\\r\n]/g, (ch) => tagEscapeMap[ch]);
}

function unescapeTag(s) {
	return s.replace(/\\[:s\\rn]/g, (seq) => tagUnescapeMap[seq]);
}

export function parseTags(s) {
	var tags = {};
	s.split(";").forEach((s) => {
		if (!s) {
			return;
		}
		var parts = s.split("=", 2);
		var k = parts[0];
		var v = null;
		if (parts.length == 2) {
			v = unescapeTag(parts[1]);
			if (v.endsWith("\\")) {
				v = v.slice(0, v.length - 1)
			}
		}
		tags[k] = v;
	});
	return tags;
}

export function formatTags(tags) {
	var l = [];
	for (var k in tags) {
		if (tags[k] === undefined || tags[k] === null) {
			l.push(k);
			continue;
		}
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

/** Split a prefix and a name out of a target. */
export function parseTargetPrefix(s, allowedPrefixes = STD_MEMBERSHIPS) {
	var i;
	for (i = 0; i < s.length; i++) {
		if (allowedPrefixes.indexOf(s[i]) < 0) {
			break;
		}
	}

	return {
		prefix: s.slice(0, i),
		name: s.slice(i),
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
	// TODO: case-mapping handling
	if (msg.prefix && msg.prefix.name == nick) {
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

export function parseISUPPORT(tokens, params) {
	var changed = [];
	tokens.forEach((tok) => {
		if (tok.startsWith("-")) {
			var k = tok.slice(1);
			params.delete(k.toUpperCase());
			return;
		}

		var i = tok.indexOf("=");
		var k = tok, v = "";
		if (i >= 0) {
			k = tok.slice(0, i);
			v = tok.slice(i + 1);
		}

		k = k.toUpperCase();

		params.set(k, v);
		changed.push(k);
	});
	return changed;
}

export const CaseMapping = {
	ASCII(str) {
		var out = "";
		for (var i = 0; i < str.length; i++) {
			var ch = str[i];
			if ("A" <= ch && ch <= "Z") {
				ch = ch.toLowerCase();
			}
			out += ch;
		}
		return out;
	},

	RFC1459(str) {
		var out = "";
		for (var i = 0; i < str.length; i++) {
			var ch = str[i];
			if ("A" <= ch && ch <= "Z") {
				ch = ch.toLowerCase();
			} else if (ch == "{") {
				ch = "[";
			} else if (ch == "}") {
				ch = "]";
			} else if (ch == "\\") {
				ch = "|";
			} else if (ch == "~") {
				ch = "^";
			}
			out += ch;
		}
		return out;
	},

	RFC1459Strict(str) {
		var out = "";
		for (var i = 0; i < str.length; i++) {
			var ch = str[i];
			if ("A" <= ch && ch <= "Z") {
				ch = ch.toLowerCase();
			} else if (ch == "{") {
				ch = "[";
			} else if (ch == "}") {
				ch = "]";
			} else if (ch == "\\") {
				ch = "|";
			}
			out += ch;
		}
		return out;
	},

	byName(name) {
		switch (name) {
		case "ascii":
			return CaseMapping.ASCII;
		case "rfc1459":
			return CaseMapping.RFC1459;
		case "rfc1459-strict":
			return CaseMapping.RFC1459Strict;
		}
		return null;
	},
};

function createIterator(next) {
	var it = { next };
	// Not defining this can lead to surprises when feeding the iterator
	// to e.g. Array.from
	it[Symbol.iterator] = () => it;
	return it;
}

function mapIterator(it, f) {
	return createIterator(() => {
		var { value, done } = it.next();
		if (done) {
			return { done: true };
		}
		return { value: f(value), done: false };
	});
}

export class CaseMapMap {
	caseMap = null;
	map = null;

	constructor(iterable, cm) {
		if ((iterable instanceof CaseMapMap) && (iterable.caseMap === cm || !cm)) {
			// Fast-path if we're just cloning another CaseMapMap
			this.caseMap = iterable.caseMap;
			this.map = new Map(iterable.map);
		} else {
			if (!cm) {
				throw new Error("Missing case-mapping when creating CaseMapMap");
			}

			this.caseMap = cm;
			this.map = new Map();

			if (iterable) {
				for (var [key, value] of iterable) {
					this.set(key, value);
				}
			}
		}
	}

	get size() {
		return this.map.size;
	}

	has(key) {
		return this.map.has(this.caseMap(key));
	}

	get(key) {
		var kv = this.map.get(this.caseMap(key));
		if (kv) {
			return kv.value;
		}
		return undefined;
	}

	set(key, value) {
		this.map.set(this.caseMap(key), { key, value });
	}

	delete(key) {
		this.map.delete(this.caseMap(key));
	}

	entries() {
		var it = this.map.values();
		return mapIterator(it, (kv) => {
			return [kv.key, kv.value];
		});
	}

	keys() {
		var it = this.map.values();
		return mapIterator(it, (kv) => {
			return kv.key;
		});
	}

	values() {
		var it = this.map.values();
		return mapIterator(it, (kv) => {
			return kv.value;
		});
	}

	[Symbol.iterator]() {
		return this.entries();
	}
}

/** Parse the ISUPPORT PREFIX token */
export function parseMembershipModes(str) {
	if (str[0] !== "(") {
		throw new Error("malformed ISUPPORT PREFIX value: expected opening parenthesis");
	}

	var sep = str.indexOf(")");
	if (sep < 0) {
		throw new Error("malformed ISUPPORT PREFIX value: expected closing parenthesis");
	}

	var n = str.length - sep - 1;
	var memberships = [];
	for (var i = 0; i < n; i++) {
		var mode = str[i + 1];
		var prefix = str[sep + i + 1];
		memberships.push({ mode, prefix });
	}
	return memberships;
}
