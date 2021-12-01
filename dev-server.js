import * as http from "http";
import * as tls from "tls";
import split from "split";
import { Server as StaticServer } from "node-static";
import { WebSocketServer } from "ws";

const WS_BAD_GATEWAY = 1014;

let localPort = 8080;
let remoteHost;
let remotePort = 6697;

let args = process.argv.slice(2);
if (args[0] === "-p") {
	localPort = parseInt(args[1], 10);
	args = args.slice(2);
}
remoteHost = args[0];

let staticServer = new StaticServer(".");

let server = http.createServer((req, res) => {
	staticServer.serve(req, res);
});

if (remoteHost) {
	let wsServer = new WebSocketServer({ server });
	wsServer.on("connection", (ws) => {
		let client = tls.connect(remotePort, remoteHost, {
			ALPNProtocols: ["irc"],
		});

		ws.on("message", (data) => {
			client.write(data.toString() + "\r\n");
		});

		ws.on("close", () => {
			client.destroy();
		});

		client.pipe(split()).on("data", (data) => {
			ws.send(data.toString());
		});

		client.on("end", () => {
			ws.close();
		});

		client.on("error", () => {
			ws.close(WS_BAD_GATEWAY);
		});
	});
}

server.listen(localPort, "localhost");

let msg = "HTTP server listening on http://localhost:" + localPort;
if (remoteHost) {
	msg += " and proxying WebSockets to " + remoteHost;
}
console.log(msg);
