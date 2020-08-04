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

function isDigit(ch) {
	return ch >= "0" && ch <= "9";
}

export function strip(text) {
	var out = "";
	for (var i = 0; i < text.length; i++) {
		var ch = text[i];
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
			i += 6;
			break;
		default:
			out += ch;
		}
	}
	return out;
}
