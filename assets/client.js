var server = {
	name: "chat.freenode.net",
	url: "ws://localhost:8080",
	username: "soju-test-user/irc.freenode.net",
	realname: "soju-test-user",
	nick: "soju-test-user",
	pass: "soju-test-user",
};

var buffers = {};
var activeBuffer = null;

var bufferListElt = document.getElementById("buffer-list");
var logElt = document.getElementById("log");
var composerElt = document.getElementById("composer");
var composerInputElt = document.getElementById("composer-input");

function djb2(s) {
	var hash = 5381;
	for (var i = 0; i < s.length; i++) {
		hash = (hash << 5) + hash + s.charCodeAt(i);
		hash = hash >>> 0; // convert to uint32
	}
	return hash;
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

	switch (msg.command) {
	case "NOTICE":
	case "PRIVMSG":
		var text = msg.params[1];

		line.className += " talk";

		var nick = document.createElement("a");
		nick.href = "#";
		nick.className = "nick nick-" + (djb2(msg.prefix.name) % 16 + 1);
		nick.innerText = msg.prefix.name;
		nick.onclick = function(event) {
			event.preventDefault();
			switchBuffer(createBuffer(msg.prefix.name));
		};

		line.appendChild(document.createTextNode(" <"));
		line.appendChild(nick);
		line.appendChild(document.createTextNode("> "));
		line.appendChild(document.createTextNode(text));
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

	buf = {
		name: name,
		li: li,
		messages: [],
		readOnly: false,

		addMessage: function(msg) {
			buf.messages.push(msg);

			if (activeBuffer == buf) {
				logElt.appendChild(createMessageElement(msg));
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

	logElt.innerHTML = "";
	for (var msg of buf.messages) {
		logElt.appendChild(createMessageElement(msg));
	}

	composerElt.classList.toggle("read-only", buf.readOnly);
	if (!buf.readOnly) {
		composerInputElt.focus();
	}
}

var serverBuffer = createBuffer(server.name);
serverBuffer.readOnly = true;
switchBuffer(serverBuffer);

var ws = new WebSocket(server.url);

ws.onopen = function() {
	console.log("Connection opened");

	if (server.pass) {
		ws.send(formatMessage({ command: "PASS", params: [server.pass] }));
	}
	ws.send(formatMessage({ command: "NICK", params: [server.nick] }));
	ws.send(formatMessage({
		command: "USER",
		params: [server.username, "0", "*", server.realname],
	}));
};

ws.onmessage = function(event) {
	var msg = parseMessage(event.data);
	console.log(msg);

	switch (msg.command) {
	case "NOTICE":
	case "PRIVMSG":
		var target = msg.params[0];
		if (target == server.nick) {
			target = msg.prefix.name;
		}
		createBuffer(target).addMessage(msg);
		break;
	case "JOIN":
		var channel = msg.params[0];
		if (msg.prefix.name == server.nick) {
			createBuffer(channel);
		}
		break;
	default:
		serverBuffer.addMessage(msg);
	}
};

ws.onclose = function() {
	console.log("Connection closed");
};

composerElt.onsubmit = function(event) {
	event.preventDefault();
	if (!activeBuffer || activeBuffer.readOnly) {
		return;
	}
	var target = activeBuffer.name;
	var text = composerInputElt.value;
	var msg = { command: "PRIVMSG", params: [target, text] };
	ws.send(formatMessage(msg));
	msg.prefix = { name: server.nick };
	activeBuffer.addMessage(msg);
	composerInputElt.value = "";
};
