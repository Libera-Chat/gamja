// See https://modern.ircdocs.horse/formatting.html

const BOLD = "\x02";
const ITALIC = "\x1D";
const UNDERLINE = "\x1F";
const STRIKETHROUGH = "\x1E";
const MONOSPACE = "\x11";
const COLOR = "\x03";
const COLOR_HEX = "\x04";
const REVERSE_COLOR = "\x16";
const RESET = "\x0F";

const HEX_COLOR_LENGTH = 6;

function isDigit(ch) {
	return ch >= "0" && ch <= "9";
}

function isHexColor(text) {
	if (text.length < HEX_COLOR_LENGTH) {
		return false;
	}
	for (let i = 0; i < HEX_COLOR_LENGTH; i++) {
		let ch = text[i].toUpperCase();
		let ok = (ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "F");
		if (!ok) {
			return false;
		}
	}
	return true;
}

export function strip(text) {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		let ch = text[i];
		switch (ch) {
		case BOLD:
		case ITALIC:
		case UNDERLINE:
		case STRIKETHROUGH:
		case MONOSPACE:
		case REVERSE_COLOR:
		case RESET:
			break; // skip
		case COLOR:
			if (!isDigit(text[i + 1])) {
				break;
			}
			i++;
			if (isDigit(text[i + 1])) {
				i++;
			}
			if (text[i + 1] == "," && isDigit(text[i + 2])) {
				i += 2;
				if (isDigit(text[i + 1])) {
					i++;
				}
			}
			break;
		case COLOR_HEX:
			if (!isHexColor(text.slice(i + 1))) {
				break;
			}
			i += HEX_COLOR_LENGTH;
			if (text[i + 1] == "," && isHexColor(text.slice(i + 2))) {
				i += 1 + HEX_COLOR_LENGTH;
			}
			break;
		default:
			out += ch;
		}
	}
	return out;
}
