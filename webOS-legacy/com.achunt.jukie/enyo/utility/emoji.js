/*globals window, enyo, EmojiShim */
/*
 * JukieEmoji - emoji in Jukie's text, safely, on every webOS version.
 *
 * Three facts shape this:
 *  1. Astral characters (emoji = anything needing a UTF-16 surrogate pair) cannot cross the
 *     Luna bus through a JS service (Node 0.4 + palmbus): the reply vanishes on a Pre2 and each
 *     half becomes a literal "?" on a TouchPad. So text that travels through
 *     com.achunt.jukie.service / jukie-drm is carried as the ASCII marker {{e:1F970}} (the code
 *     point in hex) - see jukie-drm's emojienc package and the service's encodeAstral.
 *  2. A device only shows an emoji if something can draw it. The owner's EmojiShim patch (a
 *     system-wide framework patch, TouchPad only so far) provides `EmojiShim`, which swaps each
 *     emoji for a 24px <img>. An engine with a colour-emoji font (Lunacy's Android WebView) draws
 *     them itself - found by a canvas test at load, not by guessing the device. Every other
 *     device (a stock Pre2, Veer, ...) shows a tofu box, so there the emoji is removed.
 *  3. db8 (C++) and the page's own memory carry real surrogate pairs fine, so a TouchPad that
 *     fetches Apple's JSON directly never has markers at all - raw emoji and markers are both
 *     accepted everywhere here.
 *
 * So: decode() on the way to the screen, encode() on the way to the service, and the
 * capability check (canRender) is made at render time from what is actually present, not from a
 * device list. Plain ES5 and no dependencies, because it runs on webOS 1.x-3.x WebKit and on
 * Lunacy. A verbatim copy lives in mojo/app/models/emoji.js - keep the two identical.
 *
 *   JukieEmoji.html(s)    -> HTML for an allowHtml control (always escaped; emoji drawn as images
 *                            by EmojiShim, raw on a native-emoji device, removed otherwise)
 *   JukieEmoji.text(s)    -> plain text for a non-HTML sink (raw on a native-emoji device, else
 *                            removed; a plain text node can't hold EmojiShim's <img>)
 *   JukieEmoji.strip(s)   -> plain text with every emoji removed, for surfaces that can never draw
 *                            them (status-bar banners and toasts show two tofu boxes per emoji)
 *   JukieEmoji.encode(s)  -> ASCII-marker form, for text sent TO the service
 *   JukieEmoji.encodeDeep(o) -> encode() over every string in a record, for anything written to db8
 *   JukieEmoji.decode(s)  -> markers back to real characters
 */
var JukieEmoji = (function () {
	var MARK = /\{\{e:([0-9A-Fa-f]{4,6})\}\}/g;
	var LONE = /[\uD800-\uDFFF]/g;          // either half of a surrogate pair, or a stray one
	var HAS_SURROGATE = /[\uD800-\uDFFF]/;  // non-global: safe to .test() repeatedly
	var PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
	var nativeDraw = false;

	function str(s) {
		return (s === null || s === undefined) ? "" : String(s);
	}

	function escapeHtml(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	function fromCodePoint(cp) {
		cp -= 0x10000;
		return String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
	}

	function validCodePoint(cp) {
		return cp >= 0x10000 && cp <= 0x10FFFF;
	}

	// Markers -> the real characters. Anything that only looks like a marker is left alone.
	function decode(s) {
		s = str(s);
		if (s.indexOf("{{e:") === -1) { return s; }
		return s.replace(MARK, function (m, hex) {
			var cp = parseInt(hex, 16);
			return validCodePoint(cp) ? fromCodePoint(cp) : m;
		});
	}

	// Real astral characters -> markers (lone surrogates have no code point: dropped).
	function encode(s) {
		s = str(s);
		if (!HAS_SURROGATE.test(s)) { return s; }
		return s.replace(PAIR, function (p) {
			var cp = ((p.charCodeAt(0) - 0xD800) << 10) + (p.charCodeAt(1) - 0xDC00) + 0x10000;
			return "{{e:" + cp.toString(16).toUpperCase() + "}}";
		}).replace(LONE, "");
	}

	// encode() applied to every string inside a record (arrays and plain objects are copied, never
	// changed in place - the caller may still be holding the original). Used before anything is
	// written to db8: on the TouchPad a real emoji does not survive a db8 write/read (it comes back
	// as a single U+FFFD), but the ASCII marker does, and decodes at render time.
	function encodeDeep(v) {
		var out, i, k;
		if (typeof v === "string") { return encode(v); }
		if (v === null || typeof v !== "object") { return v; }
		if (Object.prototype.toString.call(v) === "[object Array]") {
			out = [];
			for (i = 0; i < v.length; i++) { out.push(encodeDeep(v[i])); }
			return out;
		}
		out = {};
		for (k in v) {
			if (Object.prototype.hasOwnProperty.call(v, k)) { out[k] = encodeDeep(v[k]); }
		}
		return out;
	}

	// Remove every emoji, marker form and raw form alike. Trims only if something was removed,
	// so "90s <emoji>" reads "90s" rather than "90s ".
	function strip(s) {
		var before = str(s), out = before;
		if (out.indexOf("{{e:") !== -1) {
			out = out.replace(MARK, function (m, hex) { return validCodePoint(parseInt(hex, 16)) ? "" : m; });
		}
		out = out.replace(LONE, "");
		return out === before ? out : out.replace(/^\s+|\s+$/g, "");
	}

	function hasShim() {
		return typeof EmojiShim !== "undefined" && !!EmojiShim && typeof EmojiShim.render === "function";
	}

	// Can this engine draw a colour emoji by itself? Asked of the engine, not guessed from a version
	// number or a device name: draw U+1F600 in black on a canvas and look for coloured pixels. A
	// colour-emoji font (Lunacy's Android WebView, any modern browser) paints yellow; webOS's WebKit
	// paints nothing or a black/grey tofu box, so every channel stays equal and this says no. Run
	// once when the script loads.
	function detectNative() {
		try {
			if (typeof document === "undefined") { return false; }
			var c = document.createElement("canvas");
			c.width = 32; c.height = 32;
			var g = c.getContext && c.getContext("2d");
			if (!g || !g.fillText || !g.getImageData) { return false; }
			g.textBaseline = "top";
			g.font = "24px sans-serif";
			g.fillStyle = "#000000";
			g.fillText("😀", 2, 2);
			var d = g.getImageData(0, 0, 32, 32).data, i, hi, lo;
			for (i = 0; i < d.length; i += 4) {
				if (d[i + 3] > 64) {
					hi = Math.max(d[i], d[i + 1], d[i + 2]);
					lo = Math.min(d[i], d[i + 1], d[i + 2]);
					if (hi - lo > 48) { return true; }
				}
			}
		} catch (e) { /* no canvas, or it refused: not native */ }
		return false;
	}

	nativeDraw = detectNative();

	// Manual override (tests, or a device the check gets wrong).
	function setNative(v) {
		nativeDraw = !!v;
	}

	function canRender() {
		return nativeDraw || hasShim();
	}

	function text(s) {
		var t = decode(s);
		return nativeDraw ? t : strip(t);
	}

	function html(s) {
		var t = decode(s);
		if (hasShim()) {
			try { return EmojiShim.render(t); } catch (e) { /* fall through to the plain paths */ }
		}
		return escapeHtml(nativeDraw ? t : strip(t));
	}

	// Enyo helpers. A control that shows library text must be allowHtml so the <img> markup
	// survives; html() has already escaped everything else, so that is safe. Flyweight list rows
	// assign .content directly (cheap, no setter), others use setContent.
	function setContent(ctrl, s) {
		if (ctrl) {
			ctrl.allowHtml = true;
			ctrl.setContent(html(s));
		}
	}

	function rowContent(ctrl, s) {
		if (ctrl) {
			ctrl.allowHtml = true;
			ctrl.content = html(s);
		}
	}

	function describe() {
		var patched = (typeof enyo !== "undefined" && enyo.emojiShimPatched === true);
		// native: the canvas test result (or a manual override)
		return "shim=" + hasShim() + " enyoPatched=" + patched + " native=" + nativeDraw + " canRender=" + canRender();
	}

	return {
		encode: encode, encodeDeep: encodeDeep, decode: decode, strip: strip, text: text, html: html,
		hasShim: hasShim, setNative: setNative, canRender: canRender,
		setContent: setContent, rowContent: rowContent, escapeHtml: escapeHtml, describe: describe
	};
}());
