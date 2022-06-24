const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/* The JS world is still in the stone age. We're in 2022 and we still don't
 * have the technology to correctly base64-encode a UTF-8 string. Can't wait
 * the next industrial revolution.
 *
 * For more info, see:
 * https://developer.mozilla.org/en-US/docs/Glossary/Base64#the_unicode_problem
 */
export function encode(data) {
	if (!window.TextEncoder) {
		return btoa(data);
	}

	var encoder = new TextEncoder();
	var bytes = encoder.encode(data);

	var trailing = bytes.length % 3;
	var out = "";
	for (var i = 0; i < bytes.length - trailing; i += 3) {
		var u24 = (bytes[i] << 16) + (bytes[i + 1] << 8) + bytes[i + 2];
		out += alphabet[(u24 >> 18) & 0x3F];
		out += alphabet[(u24 >> 12) & 0x3F];
		out += alphabet[(u24 >> 6) & 0x3F];
		out += alphabet[u24 & 0x3F];
	}

	if (trailing == 1) {
		var u8 = bytes[bytes.length - 1];
		out += alphabet[u8 >> 2];
		out += alphabet[(u8 << 4) & 0x3F];
		out += "==";
	} else if (trailing == 2) {
		var u16 = (bytes[bytes.length - 2] << 8) + bytes[bytes.length - 1];
		out += alphabet[u16 >> 10];
		out += alphabet[(u16 >> 4) & 0x3F];
		out += alphabet[(u16 << 2) & 0x3F];
		out += "=";
	}

	return out;
}
