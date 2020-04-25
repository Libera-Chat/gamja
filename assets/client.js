var server = {
	name: "chat.freenode.net",
	url: "ws://localhost:8080",
	username: "soju-test-user/chat.freenode.net",
	realname: "soju-test-user",
	nick: "soju-test-user",
	pass: "soju-test-user",
};

var buffers = {};
var activeBuffer = null;

var bufferListElt = document.querySelector("#buffer-list");
var bufferElt = document.querySelector("#buffer");
var composerElt = document.querySelector("#composer");
var composerInputElt = document.querySelector("#composer input");

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
		if (msg.prefix.name == server.nick) {
			createBuffer(channel);
		} else {
			createBuffer(channel).addMessage(msg);
		}
		break;
	case "PART":
		var channel = msg.params[0];
		createBuffer(channel).addMessage(msg);
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
	if (!text) {
		return;
	}
	var msg = { command: "PRIVMSG", params: [target, text] };
	ws.send(formatMessage(msg));
	msg.prefix = { name: server.nick };
	activeBuffer.addMessage(msg);
	composerInputElt.value = "";
};
