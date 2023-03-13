# [gamja]

A simple IRC web client.

![screenshot](https://l.sr.ht/7Npm.png)

## Usage

Requires an IRC WebSocket server.

First install dependencies:

    npm install --production

Then configure an HTTP server to serve the gamja files. Below are some
server-specific instructions.

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

### nginx

If you use nginx as a reverse HTTP proxy, make sure to bump the default read
timeout to a value higher than the IRC server PING interval. Example:

```
location / {
	root /path/to/gamja;
}

location /socket {
	proxy_pass http://127.0.0.1:8080;
	proxy_read_timeout 600s;
	proxy_http_version 1.1;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "Upgrade";
	proxy_set_header X-Forwarded-For $remote_addr;
	proxy_set_header X-Forwarded-Proto $scheme;
}
```

If you are unable to configure the proxy timeout accordingly, or if your IRC
server doesn't send PINGs, you can set the `server.ping` option in
`config.json` (see below).

### Development server

If you don't have an IRC WebSocket server at hand, gamja's development server
can be used. For instance, to run gamja on Libera Chat:

    npm install --include=dev
    npm start -- irc.libera.chat

See `npm start -- -h` for a list of options.

### Production build

Optionally, [Parcel] can be used to build a minified version of gamja.

    npm install --include=dev
    npm run build

## Query parameters

gamja settings can be overridden using URL query parameters:

- `server`: path or URL to the WebSocket server
- `nick`: nickname
- `channels`: comma-separated list of channels to join (`#` needs to be escaped)
- `open`: [IRC URL] to open
- `debug`: if set to 1, debug mode is enabled

Alternatively, the channels can be set with the URL fragment (ie, by just
appending the channel name to the gamja URL).

## Configuration file

gamja default settings can be set using a `config.json` file at the root:

```js
{
	// IRC server settings.
	"server": {
		// WebSocket URL or path to connect to (string). Defaults to "/socket".
		"url": "wss://irc.example.org",
		// Channel(s) to auto-join (string or array of strings).
		"autojoin": "#gamja",
		// Controls how the password UI is presented to the user. Set to
		// "mandatory" to require a password, "optional" to accept one but not
		// require it, "disabled" to never ask for a password, "external" to
		// use SASL EXTERNAL, "oauth2" to use SASL OAUTHBEARER. Defaults to
		// "optional".
		"auth": "optional",
		// Default nickname (string). If it contains a "*" character, it will
		// be replaced with a random string.
		"nick": "asdf",
		// Don't display the login UI, immediately connect to the server
		// (boolean).
		"autoconnect": true,
		// Interval in seconds to send PING commands (number). Set to 0 to
		// disable. Enabling PINGs can have an impact on client power usage and
		// should only be enabled if necessary.
		"ping": 60
	},
	// OAuth 2.0 settings.
	"oauth2": {
		// OAuth 2.0 server URL (string). The server must support OAuth 2.0
		// Authorization Server Metadata (RFC 8414) or OpenID Connect
		// Discovery.
		"url": "https://auth.example.org",
		// OAuth 2.0 client ID (string).
		"client_id": "asdf",
		// OAuth 2.0 client secret (string).
		"client_secret": "ghjk",
		// OAuth 2.0 scope (string).
		"scope": "profile"
	}
}
```

## Contributing

Send patches on the [mailing list], report bugs on the [issue tracker]. Discuss
in [#soju on Libera Chat].

## License

AGPLv3, see LICENSE.

Copyright (C) 2020 The gamja Contributors

[gamja]: https://sr.ht/~emersion/gamja/
[soju]: https://soju.im
[webircgateway]: https://github.com/kiwiirc/webircgateway
[mailing list]: https://lists.sr.ht/~emersion/public-inbox
[issue tracker]: https://todo.sr.ht/~emersion/gamja
[Parcel]: https://parceljs.org
[IRC URL]: https://datatracker.ietf.org/doc/html/draft-butcher-irc-url-04
[#soju on Libera Chat]: ircs://irc.libera.chat/#soju
