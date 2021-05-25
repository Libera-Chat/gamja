# [gamja]

A bare-bones IRC web client.

![screenshot](https://l.sr.ht/7Npm.png)

## Usage

Requires an IRC WebSocket server.

First install dependencies:

    npm install --production

### [soju]

Add a WebSocket listener to soju, e.g. `listen wss://127.0.0.1:8080`.

Configure your reverse proxy to serve gamja files and proxy `/socket` to soju.

### [webircgateway]

Setup webircgateway to serve gamja files:

```ini
[fileserving]
enabled = true
webroot = /path/to/gamja
```

Then connect to webircgateway and append `?server=/webirc/websocket/` to the
URL.

### Development server

Start your IRC WebSocket server, e.g. on port 8080. Then run:

    npm install
    npm start

This will start a development HTTP server for gamja. Connect to it and append
`?server=ws://localhost:8080` to the URL.

## Query parameters

gamja settings can be overridden using URL query parameters:

- `server`: path or URL to the WebSocket server
- `channels`: comma-separated list of channels to join

## Configuration file

gamja default settings can be set using a `config.json` file at the root:

```js
{
	"server": {
		// WebSocket URL to connect to (string)
		"url": "wss://irc.example.org",
		// Channel(s) to auto-join (string or array of strings)
		"autojoin": "#gamja"
	}
}
```

## Contributing

Send patches on the [mailing list], report bugs on the [issue tracker]. Discuss
in #soju on Freenode.

## License

AGPLv3, see LICENSE.

Copyright (C) 2020 The gamja Contributors

[gamja]: https://sr.ht/~emersion/gamja/
[soju]: https://soju.im
[webircgateway]: https://github.com/kiwiirc/webircgateway
[mailing list]: https://lists.sr.ht/~emersion/public-inbox
[issue tracker]: https://todo.sr.ht/~emersion/gamja
