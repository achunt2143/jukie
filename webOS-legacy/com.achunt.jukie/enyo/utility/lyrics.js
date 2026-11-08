/*globals window */
/*
 * JukieLyrics - TTML parser and line synchronization helper for Apple Music lyrics.
 *
 * Apple Music returns lyrics formatted as Timed Text Markup Language (TTML) XML:
 *  - itunes:timing="Line" -> <p begin="..." end="...">Line text</p>
 *  - itunes:timing="Word" -> <p ...><span begin="..." end="...">Word</span></p>
 *  - itunes:timing="None" -> <p>Static text line</p>
 *
 * Timestamps may be in "HH:MM:SS.mmm" / "MM:SS.mmm" or raw seconds "SS.mmm".
 */
var JukieLyrics = {

	// Parse timestamps in "HH:MM:SS.mmm", "MM:SS.mmm", or raw seconds into a float number of seconds.
	parseTime: function (str) {
		if (!str) { return 0; }
		if (str.indexOf(":") !== -1) {
			var parts = str.split(":");
			if (parts.length === 3) {
				return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
			}
			if (parts.length === 2) {
				return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
			}
		}
		return parseFloat(str) || 0;
	},

	// Decode common XML entities (&amp;, &apos;, &quot;, &lt;, &gt;)
	decodeEntities: function (str) {
		if (!str) { return ""; }
		return str
			.replace(/&amp;/g, "&")
			.replace(/&apos;/g, "'")
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">");
	},

	// HTML-escape a string for safe DOM insertion
	escapeHTML: function (str) {
		if (!str) { return ""; }
		return String(str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	},

	// Extracts the raw TTML XML string from an Apple Music API response JSON object
	extractTTML: function (response) {
		if (!response || !response.data || !response.data[0] || !response.data[0].attributes) {
			return null;
		}
		var attrs = response.data[0].attributes;
		return attrs.ttml || attrs.ttmlLocalizations || null;
	},

	// Parses raw TTML XML into a clean, structured lyrics object:
	// {
	//   timing: "Line" | "Word" | "None",
	//   songwriters: ["Name1", ...],
	//   lines: [
	//     { begin: 7.658, end: 9.659, text: "I ain't no clown, all the jokes on you" },
	//     ...
	//   ]
	// }
	parseTTML: function (ttml) {
		if (!ttml) { return null; }

		var timing = "Line";
		var timingMatch = ttml.match(/itunes:timing="([^"]+)"/);
		if (timingMatch) { timing = timingMatch[1]; }

		var songwriters = [];
		var swMatch = ttml.match(/<songwriter>([\s\S]*?)<\/songwriter>/g);
		var i;
		if (swMatch) {
			for (i = 0; i < swMatch.length; i++) {
				var name = swMatch[i].replace(/<\/?songwriter>/g, "").trim();
				if (name) { songwriters.push(this.decodeEntities(name)); }
			}
		}

		var lines = [];
		var pRegex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/gi;
		var match;
		while ((match = pRegex.exec(ttml)) !== null) {
			var attrs = match[1];
			var inner = match[2];
			var b = attrs.match(/begin="([^"]+)"/);
			var e = attrs.match(/end="([^"]+)"/);

			// Strip child tags (e.g. <span> for word-timed lyrics) to get clean line text
			var text = this.decodeEntities(inner.replace(/<[^>]+>/g, "").trim());
			if (text) {
				lines.push({
					begin: b ? this.parseTime(b[1]) : null,
					end: e ? this.parseTime(e[1]) : null,
					text: text
				});
			}
		}

		// Fallback for untimed lyrics formatted with plain <p> tags without attributes
		if (lines.length === 0) {
			var pSimpleRegex = /<p>([\s\S]*?)<\/p>/gi;
			while ((match = pSimpleRegex.exec(ttml)) !== null) {
				var plainText = this.decodeEntities(match[1].replace(/<[^>]+>/g, "").trim());
				if (plainText) {
					lines.push({ begin: null, end: null, text: plainText });
				}
			}
		}

		return {
			timing: timing,
			songwriters: songwriters,
			lines: lines
		};
	},

	// Given an array of parsed lines and the current playback position in seconds,
	// returns the index of the line that is currently active, or -1 if before the first line.
	findActiveLineIndex: function (lines, currentTime) {
		if (!lines || !lines.length) { return -1; }
		var activeIdx = -1;
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			if (line.begin !== null && line.begin !== undefined) {
				if (currentTime >= line.begin) {
					activeIdx = i;
				} else {
					break;
				}
			}
		}
		return activeIdx;
	}
};
