/*globals window */
/*
 * JukieAdts - frame index for the raw ADTS AAC files jukie-drm leaves in the cache.
 *
 * Why this exists: on Lunacy the page plays the cached file through an <audio> element, but
 * a raw ADTS stream has no length index, so the browser both misreports its duration (a
 * 172s track read as 274s) and cannot seek it (a seek lands back at the start). ADTS is
 * simple enough to index ourselves: every frame starts with a 7-byte header (sync 0xFFF,
 * the 13-bit frame length at bits 30-42) and holds 1024 samples, so walking the headers
 * gives the exact frame count (= exact duration) and the byte offset of any moment. A seek
 * then just hands the player a Blob that starts at the right frame.
 */
var JukieAdts = {

	SAMPLE_RATES: [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350],

	// bytes: Uint8Array. durationMs (optional): the real length from jukie-drm's sidecar; if
	// given, frame length is calibrated to it (covers streams whose header sample rate isn't
	// the playback rate, e.g. HE-AAC). Returns {offsets:[byte offset of each frame],
	// frameSec, durationSec}; offsets is empty if the data has no ADTS frames.
	index: function (bytes, durationMs) {
		var offsets = [], i = 0, n = bytes.length, rate = 0, len;
		while (i + 7 <= n) {
			// Sync word 0xFFF; anything else is junk or a torn frame - resync a byte at a time.
			if (bytes[i] !== 0xFF || (bytes[i + 1] & 0xF0) !== 0xF0) { i++; continue; }
			len = ((bytes[i + 3] & 0x03) << 11) | (bytes[i + 4] << 3) | (bytes[i + 5] >> 5);
			if (len < 7) { i++; continue; }
			if (!rate) { rate = this.SAMPLE_RATES[(bytes[i + 2] >> 2) & 0x0F] || 44100; }
			offsets.push(i);
			i += len;
		}
		var frameSec = rate ? (1024 / rate) : 0;
		if (durationMs > 0 && offsets.length) {
			var calibrated = (durationMs / 1000) / offsets.length;
			// Trust the sidecar only if it is in the right ballpark of what the headers say
			// (guards against a garbage duration); otherwise keep the header-derived value.
			if (!frameSec || (calibrated > frameSec * 0.4 && calibrated < frameSec * 2.5)) { frameSec = calibrated; }
		}
		return { offsets: offsets, frameSec: frameSec, durationSec: offsets.length * frameSec };
	},

	// Index of the frame containing `seconds` (clamped to the file).
	frameAt: function (idx, seconds) {
		if (!idx.offsets.length || !idx.frameSec) { return 0; }
		var f = Math.floor(Math.max(0, seconds) / idx.frameSec);
		return Math.min(f, idx.offsets.length - 1);
	}
};
