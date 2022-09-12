function formatQueryString(params) {
	let l = [];
	for (let k in params) {
		l.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
	}
	return l.join("&");
}

export async function fetchServerMetadata(url) {
	// TODO: handle path in config.oauth2.url
	let resp;
	try {
		resp = await fetch(url + "/.well-known/oauth-authorization-server");
		if (!resp.ok) {
			throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
		}
	} catch (err) {
		console.warn("OAuth 2.0 server doesn't support Authorization Server Metadata (retrying with OpenID Connect Discovery): ", err);
		resp = await fetch(url + "/.well-known/openid-configuration");
		if (!resp.ok) {
			throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
		}
	}

	let data = await resp.json();
	if (!data.issuer) {
		throw new Error("Missing issuer in response");
	}
	if (!data.authorization_endpoint) {
		throw new Error("Missing authorization_endpoint in response");
	}
	if (!data.token_endpoint) {
		throw new Error("Missing authorization_endpoint in response");
	}
	if (!data.response_types_supported.includes("code")) {
		throw new Error("Server doesn't support authorization code response type");
	}
	return data;
}

export function redirectAuthorize({ serverMetadata, clientId, redirectUri, scope }) {
	// TODO: move fragment to query string in redirect_uri
	// TODO: use the state param to prevent cross-site request
	// forgery
	let params = {
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
	};
	if (scope) {
		params.scope = scope;
	}
	window.location.assign(serverMetadata.authorization_endpoint + "?" + formatQueryString(params));
}

function buildPostHeaders(clientId, clientSecret) {
	let headers = {
		"Content-Type": "application/x-www-form-urlencoded",
		"Accept": "application/json",
	};
	if (clientSecret) {
		headers["Authorization"] = "Basic " + btoa(encodeURIComponent(clientId) + ":" + encodeURIComponent(clientSecret));
	}
	return headers;
}

export async function exchangeCode({ serverMetadata, redirectUri, code, clientId, clientSecret }) {
	let data = {
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri,
	};
	if (!clientSecret) {
		data.client_id = clientId;
	}

	let resp = await fetch(serverMetadata.token_endpoint, {
		method: "POST",
		headers: buildPostHeaders(clientId, clientSecret),
		body: formatQueryString(data),
	});

	if (!resp.ok) {
		throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
	}
	data = await resp.json();

	if (data.error) {
		throw new Error("Authentication failed: " + (data.error_description || data.error));
	}

	return data;
}

export async function introspectToken({ serverMetadata, token, clientId, clientSecret }) {
	let resp = await fetch(serverMetadata.introspection_endpoint, {
		method: "POST",
		headers: buildPostHeaders(clientId, clientSecret),
		body: formatQueryString({ token }),
	});
	if (!resp.ok) {
		throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
	}
	let data = await resp.json();
	if (!data.active) {
		throw new Error("Expired token");
	}
	return data;
}
