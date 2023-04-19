// RFC 1459
export const RPL_WELCOME = "001";
export const RPL_YOURHOST = "002";
export const RPL_CREATED = "003";
export const RPL_MYINFO = "004";
export const RPL_ISUPPORT = "005";
export const RPL_UMODEIS = "221";
export const RPL_TRYAGAIN = "263";
export const RPL_AWAY = "301";
export const RPL_WHOISUSER = "311";
export const RPL_WHOISSERVER = "312";
export const RPL_WHOISOPERATOR = "313";
export const RPL_WHOISIDLE = "317";
export const RPL_ENDOFWHOIS = "318";
export const RPL_WHOISCHANNELS = "319";
export const RPL_ENDOFWHO = "315";
export const RPL_CHANNELMODEIS = "324";
export const RPL_NOTOPIC = "331";
export const RPL_TOPIC = "332";
export const RPL_TOPICWHOTIME = "333";
export const RPL_INVITING = "341";
export const RPL_INVITELIST = "346";
export const RPL_ENDOFINVITELIST = "347";
export const RPL_EXCEPTLIST = "348";
export const RPL_ENDOFEXCEPTLIST = "349";
export const RPL_WHOREPLY = "352";
export const RPL_NAMREPLY = "353";
export const RPL_WHOSPCRPL = "354";
export const RPL_ENDOFNAMES = "366";
export const RPL_BANLIST = "367";
export const RPL_ENDOFBANLIST = "368";
export const RPL_MOTD = "372";
export const RPL_MOTDSTART = "375";
export const RPL_ENDOFMOTD = "376";
export const ERR_UNKNOWNERROR = "400";
export const ERR_NOSUCHNICK = "401";
export const ERR_NOSUCHCHANNEL = "403";
export const ERR_TOOMANYCHANNELS = "405";
export const ERR_UNKNOWNCOMMAND = "421";
export const ERR_NOMOTD = "422";
export const ERR_ERRONEUSNICKNAME = "432";
export const ERR_NICKNAMEINUSE = "433";
export const ERR_NICKCOLLISION = "436";
export const ERR_NEEDMOREPARAMS = "461";
export const ERR_NOPERMFORHOST = "463";
export const ERR_PASSWDMISMATCH = "464";
export const ERR_YOUREBANNEDCREEP = "465";
export const ERR_CHANNELISFULL = "471";
export const ERR_INVITEONLYCHAN = "473";
export const ERR_BANNEDFROMCHAN = "474";
export const ERR_BADCHANNELKEY = "475";
// RFC 2812
export const ERR_UNAVAILRESOURCE = "437";
// Other
export const RPL_CHANNEL_URL = "328";
export const RPL_CREATIONTIME = "329";
export const RPL_QUIETLIST = "728";
export const RPL_ENDOFQUIETLIST = "729";
// IRCv3 MONITOR: https://ircv3.net/specs/extensions/monitor
export const RPL_MONONLINE = "730";
export const RPL_MONOFFLINE = "731";
export const RPL_MONLIST = "732";
export const RPL_ENDOFMONLIST = "733";
export const ERR_MONLISTFULL = "734";
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
export const STD_CHANTYPES = "#&+!";

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
	let tags = {};
	s.split(";").forEach((s) => {
		if (!s) {
			return;
		}
		let parts = s.split("=", 2);
		let k = parts[0];
		let v = null;
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
	let l = [];
	for (let k in tags) {
		if (tags[k] === undefined || tags[k] === null) {
			l.push(k);
			continue;
		}
		let v = escapeTag(tags[k]);
		l.push(k + "=" + v);
	}
	return l.join(";");
}

export function parsePrefix(s) {
	let prefix = {
		name: null,
		user: null,
		host: null,
	};

	let host = null;
	let i = s.indexOf("@");
	if (i > 0) {
		host = s.slice(i + 1);
		s = s.slice(0, i);
	}

	let user = null;
	i = s.indexOf("!");
	if (i > 0) {
		user = s.slice(i + 1);
		s = s.slice(0, i);
	}

	return { name: s, user, host };
}

function formatPrefix(prefix) {
	let s = prefix.name;
	if (prefix.user) {
		s += "!" + prefix.user;
	}
	if (prefix.host) {
		s += "@" + prefix.host;
	}
	return s;
}

export function parseMessage(s) {
	if (s.endsWith("\r\n")) {
		s = s.slice(0, s.length - 2);
	}

	let msg = {
		tags: {},
		prefix: null,
		command: null,
		params: [],
	};

	if (s.startsWith("@")) {
		let i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after tags");
		}
		msg.tags = parseTags(s.slice(1, i));
		s = s.slice(i + 1);
	}

	if (s.startsWith(":")) {
		let i = s.indexOf(" ");
		if (i < 0) {
			throw new Error("expected a space after prefix");
		}
		msg.prefix = parsePrefix(s.slice(1, i));
		s = s.slice(i + 1);
	}

	let i = s.indexOf(" ");
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
	let s = "";
	if (msg.tags && Object.keys(msg.tags).length > 0) {
		s += "@" + formatTags(msg.tags) + " ";
	}
	if (msg.prefix) {
		s += ":" + formatPrefix(msg.prefix) + " ";
	}
	s += msg.command;
	if (msg.params && msg.params.length > 0) {
		for (let i = 0; i < msg.params.length - 1; i++) {
			s += " " + msg.params[i]
		}

		let last = String(msg.params[msg.params.length - 1]);
		if (last.length === 0 || last.startsWith(":") || last.indexOf(" ") >= 0) {
			s += " :" + last;
		} else {
			s += " " + last;
		}
	}
	return s;
}

/** Split a prefix and a name out of a target. */
export function parseTargetPrefix(s, allowedPrefixes = STD_MEMBERSHIPS) {
	let i;
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
		return new RegExp(/^[\p{L}0-9]$/, "u");
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
	default:
		return !alphaNum.test(ch);
	}
}

export function isHighlight(msg, nick, cm) {
	if (msg.command != "PRIVMSG" && msg.command != "NOTICE") {
		return false;
	}

	nick = cm(nick);

	if (msg.prefix && cm(msg.prefix.name) == nick) {
		return false; // Our own messages aren't highlights
	}

	let text = cm(msg.params[1]);
	while (true) {
		let i = text.indexOf(nick);
		if (i < 0) {
			return false;
		}

		// Detect word boundaries
		let left = "\x00", right = "\x00";
		if (i > 0) {
			left = text[i - 1];
		}
		if (i + nick.length < text.length) {
			right = text[i + nick.length];
		}
		if (isWordBoundary(left) && isWordBoundary(right)) {
			return true;
		}

		text = text.slice(i + nick.length);
	}
}

export function isServerBroadcast(msg) {
	if (msg.command != "PRIVMSG" && msg.command != "NOTICE") {
		return false;
	}
	return msg.params[0].startsWith("$");
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
	case ERR_MONLISTFULL:
		return true;
	case "FAIL":
		return true;
	default:
		return false;
	}
}

export function formatDate(date) {
	// ISO 8601
	let YYYY = date.getUTCFullYear().toString().padStart(4, "0");
	let MM = (date.getUTCMonth() + 1).toString().padStart(2, "0");
	let DD = date.getUTCDate().toString().padStart(2, "0");
	let hh = date.getUTCHours().toString().padStart(2, "0");
	let mm = date.getUTCMinutes().toString().padStart(2, "0");
	let ss = date.getUTCSeconds().toString().padStart(2, "0");
	let sss = date.getUTCMilliseconds().toString().padStart(3, "0");
	return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}.${sss}Z`;
}

export function parseCTCP(msg) {
	if (msg.command != "PRIVMSG" && msg.command != "NOTICE") {
		return null;
	}

	let text = msg.params[1];
	if (!text.startsWith("\x01")) {
		return null;
	}
	text = text.slice(1);
	if (text.endsWith("\x01")) {
		text = text.slice(0, -1);
	}

	let ctcp;
	let i = text.indexOf(" ");
	if (i >= 0) {
		ctcp = { command: text.slice(0, i), param: text.slice(i + 1) };
	} else {
		ctcp = { command: text, param: "" };
	}
	ctcp.command = ctcp.command.toUpperCase();
	return ctcp;
}

function unescapeISUPPORTValue(s) {
	return s.replace(/\\x[0-9A-Z]{2}/gi, (esc) => {
		let hex = esc.slice(2);
		return String.fromCharCode(parseInt(hex, 16));
	});
}

export class Isupport {
	raw = new Map();

	parse(tokens) {
		tokens.forEach((tok) => {
			if (tok.startsWith("-")) {
				let k = tok.slice(1);
				this.raw.delete(k.toUpperCase());
				return;
			}

			let i = tok.indexOf("=");
			let k = tok, v = "";
			if (i >= 0) {
				k = tok.slice(0, i);
				v = unescapeISUPPORTValue(tok.slice(i + 1));
			}

			k = k.toUpperCase();

			this.raw.set(k, v);
		});
	}

	caseMapping() {
		let name = this.raw.get("CASEMAPPING");
		if (!name) {
			return CaseMapping.RFC1459;
		}
		let cm = CaseMapping.byName(name);
		if (!cm) {
			console.error("Unsupported case-mapping '" + name + "', falling back to RFC 1459");
			return CaseMapping.RFC1459;
		}
		return cm;
	}

	monitor() {
		if (!this.raw.has("MONITOR")) {
			return 0;
		}
		let v = this.raw.get("MONITOR");
		if (v === "") {
			return Infinity;
		}
		return parseInt(v, 10);
	}

	whox() {
		return this.raw.has("WHOX");
	}

	prefix() {
		return this.raw.get("PREFIX") || "";
	}

	chanTypes() {
		return this.raw.get("CHANTYPES") || STD_CHANTYPES;
	}

	statusMsg() {
		return this.raw.get("STATUSMSG");
	}

	network() {
		return this.raw.get("NETWORK");
	}

	chatHistory() {
		if (!this.raw.has("CHATHISTORY")) {
			return 0;
		}
		let n = parseInt(this.raw.get("CHATHISTORY"), 10);
		if (n <= 0) {
			return Infinity;
		}
		return n;
	}

	bouncerNetID() {
		return this.raw.get("BOUNCER_NETID");
	}

	chanModes() {
		const stdChanModes = ["beI", "k", "l", "imnst"];
		if (!this.raw.has("CHANMODES")) {
			return stdChanModes;
		}
		let chanModes = this.raw.get("CHANMODES").split(",");
		if (chanModes.length != 4) {
			console.error("Invalid CHANMODES: ", this.raw.get("CHANMODES"));
			return stdChanModes;
		}
		return chanModes;
	}

	bot() {
		return this.raw.get("BOT");
	}

	userLen() {
		if (!this.raw.has("USERLEN")) {
			return 20;
		}
		return parseInt(this.raw.get("USERLEN"), 10);
	}

	hostLen() {
		if (!this.raw.has("HOSTLEN")) {
			return 63;
		}
		return parseInt(this.raw.get("HOSTLEN"), 10);
	}

	lineLen() {
		if (!this.raw.has("LINELEN")) {
			return 512;
		}
		return parseInt(this.raw.get("LINELEN"), 10);
	}
}

export function getMaxPrivmsgLen(isupport, nick, target) {
	let user = "_".repeat(isupport.userLen());
	let host = "_".repeat(isupport.hostLen());
	let prefix = { name: nick, user, host };
	let msg = { prefix, command: "PRIVMSG", params: [target, ""] };
	let raw = formatMessage(msg) + "\r\n";
	return isupport.lineLen() - raw.length;
}

export const CaseMapping = {
	ASCII(str) {
		let out = "";
		for (let i = 0; i < str.length; i++) {
			let ch = str[i];
			if ("A" <= ch && ch <= "Z") {
				ch = ch.toLowerCase();
			}
			out += ch;
		}
		return out;
	},

	RFC1459(str) {
		let out = "";
		for (let i = 0; i < str.length; i++) {
			let ch = str[i];
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
		let out = "";
		for (let i = 0; i < str.length; i++) {
			let ch = str[i];
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
	let it = { next };
	// Not defining this can lead to surprises when feeding the iterator
	// to e.g. Array.from
	it[Symbol.iterator] = () => it;
	return it;
}

function mapIterator(it, f) {
	return createIterator(() => {
		let { value, done } = it.next();
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
				for (let [key, value] of iterable) {
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
		let kv = this.map.get(this.caseMap(key));
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
		let it = this.map.values();
		return mapIterator(it, (kv) => {
			return [kv.key, kv.value];
		});
	}

	keys() {
		let it = this.map.values();
		return mapIterator(it, (kv) => {
			return kv.key;
		});
	}

	values() {
		let it = this.map.values();
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

	let sep = str.indexOf(")");
	if (sep < 0) {
		throw new Error("malformed ISUPPORT PREFIX value: expected closing parenthesis");
	}

	let n = str.length - sep - 1;
	let memberships = [];
	for (let i = 0; i < n; i++) {
		let mode = str[i + 1];
		let prefix = str[sep + i + 1];
		memberships.push({ mode, prefix });
	}
	return memberships;
}

export function findBatchByType(msg, type) {
	let batch = msg.batch;
	while (batch) {
		if (batch.type === type) {
			return batch;
		}
		batch = batch.parent;
	}
	return null;
}

export function getMessageLabel(msg) {
	if (msg.tags.label) {
		return msg.tags.label;
	}

	let batch = msg.batch;
	while (batch) {
		if (batch.tags.label) {
			return batch.tags.label;
		}
		batch = batch.parent;
	}

	return null;
}

export function forEachChannelModeUpdate(msg, isupport, callback) {
	let [a, b, c, d] = isupport.chanModes();
	let prefix = isupport.prefix();

	let typeByMode = new Map();
	Array.from(a).forEach((mode) => typeByMode.set(mode, "A"));
	Array.from(b).forEach((mode) => typeByMode.set(mode, "B"));
	Array.from(c).forEach((mode) => typeByMode.set(mode, "C"));
	Array.from(d).forEach((mode) => typeByMode.set(mode, "D"));
	parseMembershipModes(prefix).forEach((membership) => typeByMode.set(membership.mode, "B"));

	if (msg.command !== "MODE") {
		throw new Error("Expected a MODE message");
	}
	let change = msg.params[1];
	let args = msg.params.slice(2);

	let plusMinus = null;
	let j = 0;
	for (let i = 0; i < change.length; i++) {
		if (change[i] === "+" || change[i] === "-") {
			plusMinus = change[i];
			continue;
		}
		if (!plusMinus) {
			throw new Error("malformed mode string: missing plus/minus");
		}

		let mode = change[i];
		let add = plusMinus === "+";

		let modeType = typeByMode.get(mode);
		if (!modeType) {
			continue;
		}

		let arg = null;
		if (modeType === "A" || modeType === "B" || (modeType === "C" && add)) {
			arg = args[j];
			j++;
		}

		callback(mode, add, arg);
	}
}

/**
 * Check if a realname is worth displaying.
 *
 * Since the realname is mandatory, many clients set a meaningless realname.
 */
export function isMeaningfulRealname(realname, nick) {
	if (!realname || realname === nick) {
		return false;
	}

	if (realname.toLowerCase() === "realname" || realname.toLowerCase() === "unknown" || realname.toLowerCase() === "fullname") {
		return false;
	}

	// TODO: add more quirks

	return true;
}

/* Parse an irc:// URL.
 *
 * See: https://datatracker.ietf.org/doc/html/draft-butcher-irc-url-04
 */
export function parseURL(str) {
	if (!str.startsWith("irc://") && !str.startsWith("ircs://")) {
		return null;
	}

	str = str.slice(str.indexOf(":") + "://".length);

	let loc;
	let i = str.indexOf("/");
	if (i < 0) {
		loc = str;
		str = "";
	} else {
		loc = str.slice(0, i);
		str = str.slice(i + 1);
	}

	let host = loc;
	i = loc.indexOf("@");
	if (i >= 0) {
		host = loc.slice(i + 1);
		// TODO: parse authinfo
	}

	i = str.indexOf("?");
	if (i >= 0) {
		str = str.slice(0, i);
		// TODO: parse options
	}

	let enttype;
	i = str.indexOf(",");
	if (i >= 0) {
		let flags = str.slice(i + 1).split(",");
		str = str.slice(0, i);

		if (flags.indexOf("isuser") >= 0) {
			enttype = "user";
		} else if (flags.indexOf("ischannel") >= 0) {
			enttype = "channel";
		}

		// TODO: parse hosttype
	}

	let entity = decodeURIComponent(str);
	if (!enttype) {
		// TODO: technically we should use the PREFIX ISUPPORT here
		enttype = entity.startsWith("#") ? "channel" : "user";
	}

	return { host, enttype, entity };
}

export function formatURL({ host, enttype, entity } = {}) {
	host = host || "";
	entity = entity || "";

	let s = "irc://" + host + "/" + encodeURIComponent(entity);
	if (enttype) {
		s += ",is" + enttype;
	}
	return s;
}

export class CapRegistry {
	available = new Map();
	enabled = new Set();

	addAvailable(s) {
		let l = s.split(" ");
		l.forEach((s) => {
			let i = s.indexOf("=");
			let k = s, v = "";
			if (i >= 0) {
				k = s.slice(0, i);
				v = s.slice(i + 1);
			}
			this.available.set(k.toLowerCase(), v);
		});
	}

	parse(msg) {
		if (msg.command !== "CAP") {
			return;
		}

		let subCmd = msg.params[1];
		let args = msg.params.slice(2);
		switch (subCmd) {
		case "LS":
			this.addAvailable(args[args.length - 1]);
			break;
		case "NEW":
			this.addAvailable(args[0]);
			break;
		case "DEL":
			args[0].split(" ").forEach((cap) => {
				cap = cap.toLowerCase();
				this.available.delete(cap);
				this.enabled.delete(cap);
			});
			break;
		case "ACK":
			args[0].split(" ").forEach((cap) => {
				cap = cap.toLowerCase();
				if (cap.startsWith("-")) {
					this.enabled.delete(cap.slice(1));
				} else {
					this.enabled.add(cap);
				}
			});
			break;
		}
	}

	requestAvailable(l) {
		l = l.filter((cap) => {
			return this.available.has(cap) && !this.enabled.has(cap);
		});

		if (l.length === 0) {
			return null;
		}
		return { command: "CAP", params: ["REQ", l.join(" ")] };
	}
}
