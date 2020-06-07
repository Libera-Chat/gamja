var server = {
	name: "server",
	username: null,
	realname: null,
	nick: null,
	pass: null,
	autojoin: [],
};

var ws = null;

var buffers = {};
var activeBuffer = null;
var serverBuffer = null;

var bufferListElt = document.querySelector("#buffer-list");
var bufferElt = document.querySelector("#buffer");
var composerElt = document.querySelector("#composer");
var composerInputElt = document.querySelector("#composer input");
var connectElt = document.querySelector("#connect");
var connectFormElt = document.querySelector("#connect form");

function djb2(s) {
	var hash = 5381;
	for (var i = 0; i < s.length; i++) {
		hash = (hash << 5) + hash + s.charCodeAt(i);
		hash = hash >>> 0; // convert to uint32
	}
	return hash;
}

function createNickElement(name) {
	var nick = document.createElement("a");
	nick.href = "#";
	nick.className = "nick nick-" + (djb2(name) % 16 + 1);
	nick.innerText = name;
	nick.onclick = function(event) {
		event.preventDefault();
		switchBuffer(createBuffer(name));
	};
	return nick;
}

function createMessageElement(msg) {
	var date = new Date();

	var line = document.createElement("div");
	line.className = "logline";

	var timestamp = document.createElement("a");
	timestamp.href = "#";
	timestamp.className = "timestamp";
	timestamp.innerText = date.toLocaleTimeString(undefined, {
		timeStyle: "short",
		hour12: false,
	});
	timestamp.onclick = function(event) {
		event.preventDefault();
	};

	line.appendChild(timestamp);
	line.appendChild(document.createTextNode(" "));

	switch (msg.command) {
	case "NOTICE":
	case "PRIVMSG":
		var text = msg.params[1];

		var actionPrefix = "\001ACTION ";
		if (text.startsWith(actionPrefix) && text.endsWith("\001")) {
			var action = text.slice(actionPrefix.length, -1);

			line.className += " me-tell";

			line.appendChild(document.createTextNode("* "));
			line.appendChild(createNickElement(msg.prefix.name));
			line.appendChild(document.createTextNode(" " + action));
		} else {
			line.className += " talk";

			line.appendChild(document.createTextNode("<"));
			line.appendChild(createNickElement(msg.prefix.name));
			line.appendChild(document.createTextNode("> "));
			line.appendChild(document.createTextNode(text));
		}
		break;
	case "JOIN":
		line.appendChild(createNickElement(msg.prefix.name));
		line.appendChild(document.createTextNode(" has joined"));
		break;
	case "PART":
		line.appendChild(createNickElement(msg.prefix.name));
		line.appendChild(document.createTextNode(" has left"));
		break;
	default:
		line.appendChild(document.createTextNode(" " + msg.command + " " + msg.params.join(" ")));
	}

	return line;
}

function createBuffer(name) {
	if (buffers[name]) {
		return buffers[name];
	}

	var a = document.createElement("a");
	a.href = "#";
	a.onclick = function(event) {
		event.preventDefault();
		switchBuffer(name);
	};
	a.innerText = name;

	var li = document.createElement("li");
	li.appendChild(a);

	var buf = {
		name: name,
		li: li,
		messages: [],
		readOnly: false,

		addMessage: function(msg) {
			buf.messages.push(msg);

			if (activeBuffer === buf) {
				bufferElt.appendChild(createMessageElement(msg));
			}
		},
	};
	buffers[name] = buf;

	bufferListElt.appendChild(li);
	return buf;
}

function switchBuffer(buf) {
	if (typeof buf == "string") {
		buf = buffers[buf];
	}
	if (activeBuffer && buf === activeBuffer) {
		return;
	}

	if (activeBuffer) {
		activeBuffer.li.classList.remove("active");
	}

	activeBuffer = buf;
	if (!buf) {
		return;
	}

	buf.li.classList.add("active");

	bufferElt.innerHTML = "";
	for (var msg of buf.messages) {
		bufferElt.appendChild(createMessageElement(msg));
	}

	composerElt.classList.toggle("read-only", buf.readOnly);
	if (!buf.readOnly) {
		composerInputElt.focus();
	}
}

function showConnectForm() {
	setConnectFormDisabled(false);
	connectElt.style.display = "block";
}

function connect() {
	try {
		ws = new WebSocket(server.url);
	} catch (err) {
		console.error(err);
		showConnectForm();
		return;
	}

	ws.onopen = function() {
		console.log("Connection opened");

		if (server.pass) {
			sendMessage({ command: "PASS", params: [server.pass] });
		}
		sendMessage({ command: "NICK", params: [server.nick] });
		sendMessage({
			command: "USER",
			params: [server.username, "0", "*", server.realname],
		});
	};

	ws.onmessage = function(event) {
		var msg = parseMessage(event.data);
		console.log("Received:", msg);

		switch (msg.command) {
		case RPL_WELCOME:
			console.log("Registration complete");
			connectElt.style.display = "none";

			if (server.autojoin.length > 0) {
				sendMessage({
					command: "JOIN",
					params: [server.autojoin.join(",")],
				});
			}
			break;
		case ERR_PASSWDMISMATCH:
			console.error("Password mismatch");
			disconnect();
			break;
		case "NOTICE":
		case "PRIVMSG":
			var target = msg.params[0];
			if (target == server.nick) {
				target = msg.prefix.name;
			}
			var buf;
			if (target == "*") {
				buf = serverBuffer;
			} else {
				buf = createBuffer(target);
			}
			buf.addMessage(msg);
			break;
		case "JOIN":
			var channel = msg.params[0];
			var buf = createBuffer(channel);
			if (msg.prefix.name != server.nick) {
				buf.addMessage(msg);
			}
			if (channel == server.autojoin[0]) {
				// TODO: only switch once right after connect
				switchBuffer(buf);
			}
			break;
		case "PART":
			var channel = msg.params[0];
			createBuffer(channel).addMessage(msg);
			break;
		case "NICK":
			var newNick = msg.params[0];
			if (msg.prefix.name == server.nick) {
				server.nick = newNick;
			}
			// TODO: append message to all buffers the user is a member of
			break;
		default:
			serverBuffer.addMessage(msg);
		}
	};

	ws.onclose = function() {
		console.log("Connection closed");
		showConnectForm();
	};

	ws.onerror = function() {
		console.error("Connection error");
	};

	serverBuffer = createBuffer(server.name);
	serverBuffer.readOnly = true;
	switchBuffer(serverBuffer);
}

function disconnect() {
	ws.close(1000);
}

function sendMessage(msg) {
	ws.send(formatMessage(msg));
	console.log("Sent:", msg);
}

function executeCommand(s) {
	var parts = s.split(" ");
	var cmd = parts[0].toLowerCase().slice(1);
	var args = parts.slice(1);
	switch (cmd) {
	case "quit":
		if (localStorage) {
			localStorage.removeItem("server");
		}
		disconnect();
		break;
	case "join":
		var channel = args[0];
		if (!channel) {
			console.error("Missing channel name");
			return;
		}
		sendMessage({ command: "JOIN", params: [channel] });
		break;
	case "part":
		// TODO: part reason
		if (!activeBuffer || activeBuffer.readOnly) {
			console.error("Not in a channel");
			return;
		}
		var channel = activeBuffer.name;
		sendMessage({ command: "PART", params: [channel] });
		break;
	default:
		console.error("Unknwon command '" + cmd + "'");
	}
}

composerElt.onsubmit = function(event) {
	event.preventDefault();

	var text = composerInputElt.value;
	composerInputElt.value = "";
	if (!text) {
		return;
	}

	if (text.startsWith("//")) {
		text = text.slice(1);
	} else if (text.startsWith("/")) {
		executeCommand(text);
		return;
	}

	if (!activeBuffer || activeBuffer.readOnly) {
		return;
	}
	var target = activeBuffer.name;

	var msg = { command: "PRIVMSG", params: [target, text] };
	sendMessage(msg);
	msg.prefix = { name: server.nick };
	activeBuffer.addMessage(msg);
};

function setConnectFormDisabled(disabled) {
	connectElt.querySelectorAll("input, button").forEach(function(elt) {
		elt.disabled = disabled;
	});
}

function parseQueryString() {
	var query = window.location.search.substring(1);
	var params = {};
	query.split('&').forEach(function(s) {
		if (!s) {
			return;
		}
		var pair = s.split('=');
		params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
	});
	return params;
}

connectFormElt.onsubmit = function(event) {
	event.preventDefault();
	setConnectFormDisabled(true);

	server.url = connectFormElt.elements.url.value;
	server.nick = connectFormElt.elements.nick.value;
	server.pass = connectFormElt.elements.password.value;
	server.username = connectFormElt.elements.username.value || server.nick;
	server.realname = connectFormElt.elements.realname.value || server.nick;

	server.autojoin = [];
	connectFormElt.elements.autojoin.value.split(",").forEach(function(ch) {
		ch = ch.trim();
		if (!ch) {
			return;
		}
		server.autojoin.push(ch);
	});

	if (localStorage) {
		if (connectFormElt.elements["remember-me"].checked) {
			localStorage.setItem("server", JSON.stringify(server));
		} else {
			localStorage.removeItem("server");
		}
	}

	connect();
};

window.onkeydown = function(event) {
	if (activeBuffer && activeBuffer.readOnly && event.key == "/" && document.activeElement != composerInputElt) {
		// Allow typing commands even in read-only buffers
		composerElt.classList.remove("read-only");
		composerInputElt.focus();
		composerInputElt.value = "";
	}
};

if (localStorage && localStorage.getItem("server")) {
	server = JSON.parse(localStorage.getItem("server"));
	connectFormElt.elements.url.value = server.url;
	connectFormElt.elements.nick.value = server.nick;
	connectFormElt.elements.password.value = server.pass;
	if (server.username != server.nick) {
		connectFormElt.elements.username.value = server.username;
	}
	if (server.realname != server.nick) {
		connectFormElt.elements.realname.value = server.realname;
	}
	connectFormElt.elements["remember-me"].checked = true;
	setConnectFormDisabled(true);
	connect();
} else {
	var params = parseQueryString();
	if (params.server) {
		connectFormElt.elements.url.value = params.server;
		document.querySelector("#connect-url-container").style.display = "none";
	}
	if (params.channels) {
		connectFormElt.elements.autojoin.value = params.channels;
	}
}
