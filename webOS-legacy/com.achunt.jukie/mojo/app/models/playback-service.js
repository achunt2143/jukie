/*globals Mojo, window, setTimeout, clearInterval, setInterval, console */
/*
 * PlaybackService - drives playback through the bundled GStreamer-backed Luna service
 * (com.achunt.jukie.service), the SAME service the Enyo app uses. On this platform an
 * HTML5 <audio> element can't play our streams (its playbin pipeline is missing the
 * "audioresample" element); the service spawns a working hand-built pipeline instead,
 * and it plays a plain decrypted .m4a that jukie-drm writes to an on-device cache. That
 * decrypted file is a standard .m4a, so playing it is ordinary local-file playback.
 *
 * Mojo port of the Enyo app's utility/audioplayer.js (kindAudioPlayer). The Luna method
 * surface (play/pause/resume/stop/getStatus/seek/setVolume/getVolume/clearCache/
 * setCredentials) and the poll-getStatus-while-active model are identical; only the call
 * mechanism (Mojo.Service.Request instead of enyo PalmService components) and the event
 * delivery (assignable callbacks instead of enyo events) changed.
 *
 * Callbacks (assign as needed): onTimeUpdate({currentTime,duration}), onPlaying(),
 * onPaused(), onEnded(), onError({error}), onBuffering({buffering}).
 */
var PlaybackService = function () {
	this._url = "";
	this._songId = "";
	this._libraryId = "";
	this._pollInterval = null;
	this._pollRate = 500;
	this._volumeThrottleTimer = null;
	this._pendingVolume = null;
	this._lastVolumeSent = 0;
	this._status = { state: "idle", isPlaying: false, position: 0, duration: 30, volume: 100 };
	this._prevState = "idle";
	this._prevBuffering = false;

	// assignable callbacks
	this.onTimeUpdate = null;
	this.onPlaying = null;
	this.onPaused = null;
	this.onEnded = null;
	this.onError = null;
	this.onBuffering = null;
	// Fired after auto-advance (see _emitTransitions' "ended" case) actually moves to a
	// new track. onEnded/onPlaying alone don't cover this: they fire for the SAME state
	// transition regardless of whether the track identity changed, so the scene has no
	// other signal telling it to repaint title/artist/album/art for the new track.
	this.onTrackChanged = null;
};

PlaybackService.prototype = {

	SERVICE: "palm://com.achunt.jukie.service/",
	VOLUME_THROTTLE_MS: 100,

	log: function () {
		if (typeof console !== "undefined" && console.log) {
			var parts = [], a = arguments, i;
			for (i = 0; i < a.length; i++) {
				parts.push((typeof a[i] === "object") ? JSON.stringify(a[i]) : ("" + a[i]));
			}
			console.log("[Playback] " + parts.join(" "));
		}
	},

	_isNumeric: function (n) {
		return typeof n === "number" && isFinite(n);
	},

	// Fire one Luna call. onOk/onFail receive the raw response.
	_svc: function (method, params, onOk, onFail) {
		var self = this;
		return new Mojo.Service.Request(this.SERVICE, {
			method: method,
			parameters: params || {},
			onSuccess: function (response) { if (onOk) { onOk.call(self, response); } },
			onFailure: function (response) { if (onFail) { onFail.call(self, response); } }
		});
	},

	isBuffering: function () { return !!this._status.buffering; },

	destroy: function () { this._stopPolling(); this._waStop(); },

	// ---- Lunacy: play through the page's own <audio> -----------------------------
	// Lunacy (webOS on Android) has no gst-launch or PulseAudio, so the service can't play
	// anything there. It only fetches (prepareSong: jukie-drm decrypts the track into the
	// cache); this backend then reads the cached raw-ADTS file and plays it with an <audio>
	// element. Everything above this class still sees the same status objects and callbacks,
	// because _waStatus() feeds onStatus() exactly like a service response would.
	//
	// Raw ADTS has no length index, so the browser can neither report its true duration nor
	// seek it - JukieAdts (adts.js) indexes the frames, position is base + audio.currentTime,
	// and a seek hands the element a Blob that starts at the target frame.

	CACHE_URL: "/media/internal/.jukie/cache/",

	// True on Lunacy. Jukie.isLunacy() is false until Lunacy has answered its boot-time
	// probe (app-assistant.js); play() waits for that, so by here it is settled.
	_webAudio: function () {
		return typeof Jukie !== "undefined" && Jukie.isLunacy && Jukie.isLunacy();
	},

	_waState: function () {
		if (!this._wa) {
			this._wa = {
				audio: null, token: 0, state: "idle", buffering: false, error: "", permissionError: false,
				bytes: null, index: null, base: 0, durationSec: 0, blobUrl: "", volume: 1, switching: false
			};
		}
		return this._wa;
	},

	// Push the current state through onStatus() as if the service had reported it.
	_waStatus: function () {
		var wa = this._waState();
		var pos = wa.base + (wa.audio && wa.audio.src ? (wa.audio.currentTime || 0) : 0);
		if (wa.durationSec > 0) { pos = Math.min(pos, wa.durationSec); }
		this.onStatus({
			returnValue: true,
			state: wa.state,
			// Like the service: "playing" even while still buffering (the spinner shows that).
			// The Now Playing scene is created right after play() and only ever sees this flag,
			// not the earlier transition, so it has to be true from the start.
			isPlaying: wa.state === "playing",
			buffering: wa.buffering,
			position: pos,
			duration: wa.durationSec > 0 ? wa.durationSec : 30,
			volume: Math.round(wa.volume * 100),
			error: wa.error,
			permissionError: wa.permissionError
		});
	},

	_waFail: function (msg, permissionError) {
		var wa = this._waState();
		wa.state = "error";
		wa.buffering = false;
		wa.error = msg || "playback error";
		wa.permissionError = !!permissionError;
		this._waDrop();
		this._waStatus();
	},

	// Release the current media (element source + blob) without touching state.
	_waDrop: function () {
		var wa = this._waState();
		if (wa.audio) {
			wa.switching = true;
			try { wa.audio.pause(); wa.audio.removeAttribute("src"); wa.audio.load(); } catch (e) {}
			wa.switching = false;
		}
		if (wa.blobUrl) { try { window.URL.revokeObjectURL(wa.blobUrl); } catch (e2) {} wa.blobUrl = ""; }
	},

	_waElement: function () {
		var wa = this._waState();
		if (wa.audio) { return wa.audio; }
		var self = this, a = new window.Audio();
		a.preload = "auto";
		a.volume = wa.volume;
		a.addEventListener("playing", function () {
			wa.state = "playing"; wa.buffering = false; self._waStatus();
		}, false);
		a.addEventListener("waiting", function () {
			if (!wa.switching && wa.state === "playing") { wa.buffering = true; self._waStatus(); }
		}, false);
		a.addEventListener("pause", function () {
			// Swapping the source for a seek also pauses the element; only a real pause counts.
			if (wa.switching || a.ended || wa.state !== "playing") { return; }
			wa.state = "paused"; wa.buffering = false; self._waStatus();
		}, false);
		a.addEventListener("timeupdate", function () {
			if (wa.state === "playing") { self._waStatus(); }
		}, false);
		a.addEventListener("ended", function () {
			wa.state = "ended"; wa.buffering = false; self._waStatus();
		}, false);
		a.addEventListener("error", function () {
			if (wa.switching || !a.src) { return; }
			self._waFail("audio error " + (a.error ? a.error.code : "?"));
		}, false);
		wa.audio = a;
		return a;
	},

	_waPlay: function () {
		var self = this, wa = this._waState(), token = ++wa.token;
		this._waDrop();
		wa.state = "playing";      // optimistic, like the service: UI shows "loading" until audio starts
		wa.buffering = true;
		wa.error = "";
		wa.permissionError = false;
		wa.bytes = null; wa.index = null; wa.base = 0; wa.durationSec = 0;
		this._waStatus();

		if (!this._songId) { // a preview clip: a plain URL, no cache involved
			var a = this._waElement();
			wa.switching = true; a.src = this._url; wa.switching = false;
			a.play();
			return;
		}
		var offlineOnly = typeof Jukie !== "undefined" && Jukie.online === false;
		this._svc("prepareSong", { songId: this._songId, libraryId: this._libraryId, offlineOnly: offlineOnly },
			function (r) {
				if (token !== wa.token) { return; } // skipped / stopped while fetching
				if (!r || r.returnValue === false) {
					if (r && r.superseded) { return; }
					this._waFail((r && r.error) || "could not fetch the track", r && r.permissionError);
					return;
				}
				this._waLoad(token, r.durationMs);
			},
			function (r) {
				if (token === wa.token) { this._waFail("playback service call failed"); }
			});
	},

	// Read the cached file, index its frames, and start playing from the top.
	_waLoad: function (token, durationMs) {
		var self = this, wa = this._waState();
		var xhr = new window.XMLHttpRequest();
		xhr.open("GET", this.CACHE_URL + encodeURIComponent(this._songId) + ".m4a", true);
		xhr.responseType = "arraybuffer";
		xhr.onload = function () {
			if (token !== wa.token) { return; }
			if (xhr.status !== 200 && xhr.status !== 0) { self._waFail("could not read the cached track (HTTP " + xhr.status + ")"); return; }
			var bytes = new window.Uint8Array(xhr.response);
			var index = JukieAdts.index(bytes, durationMs);
			if (!index.offsets.length) { self._waFail("the cached track is not playable audio"); return; }
			wa.bytes = bytes; wa.index = index; wa.durationSec = index.durationSec;
			self._waStart(0, true);
		};
		xhr.onerror = function () { if (token === wa.token) { self._waFail("could not read the cached track"); } };
		xhr.send();
	},

	// Point the <audio> at the audio from `seconds` on. autoplay: start it playing.
	_waStart: function (seconds, autoplay) {
		var wa = this._waState();
		if (!wa.bytes || !wa.index) { return; }
		var frame = JukieAdts.frameAt(wa.index, seconds);
		var blob = new window.Blob([wa.bytes.subarray(wa.index.offsets[frame])], { type: "audio/aac" });
		var oldUrl = wa.blobUrl;
		wa.blobUrl = window.URL.createObjectURL(blob);
		wa.base = frame * wa.index.frameSec;
		var a = this._waElement();
		wa.switching = true;
		a.src = wa.blobUrl;
		wa.switching = false;
		if (oldUrl) { try { window.URL.revokeObjectURL(oldUrl); } catch (e) {} }
		if (autoplay) {
			var self = this;
			var p = a.play();
			if (p && p.catch) {
				p.catch(function (e) {
					// The browser can refuse audio that didn't start from a tap (the fetch
					// finishes after the tap's own call stack). Fall back to "paused" so the
					// play button works - that tap is a gesture. A real decode problem
					// arrives through the element's error event instead.
					if (e && e.name === "NotAllowedError" && wa.state === "playing") {
						wa.state = "paused"; wa.buffering = false; self._waStatus();
					}
				});
			}
		} else {
			wa.buffering = false;
			this._waStatus();
		}
	},

	_waPause: function () {
		var wa = this._waState();
		if (!wa.audio || wa.state !== "playing") { return; }
		wa.state = "paused"; wa.buffering = false;
		wa.audio.pause();
		this._waStatus();
	},

	_waResume: function () {
		var wa = this._waState();
		if (wa.state === "paused" && wa.audio && wa.audio.src) {
			wa.state = "playing";
			wa.audio.play();
			this._waStatus();
		} else {
			this._waPlay(); // nothing loaded, or it ended/failed: start the track again
		}
	},

	_waStop: function () {
		var wa = this._waState();
		wa.token++;
		this._waDrop();
		wa.state = "idle"; wa.buffering = false; wa.error = ""; wa.base = 0;
		this._waStatus();
	},

	_waSeek: function (seconds) {
		var wa = this._waState();
		if (!wa.bytes) { return; }
		var wasPlaying = wa.state === "playing";
		this._waStart(seconds, wasPlaying);
	},

	// One-shot fetch of the REAL current status, starting polling if it turns out
	// something is playing. Needed by a scene that attaches to this instance without
	// ever itself having called play()/resume() on it - e.g. Exhibition's own separate
	// PlaybackService instance when the track was actually started from the main app's
	// stage: its _status is just constructor defaults (isPlaying:false, buffering
	// whatever it last was) until something queries the shared backend, so trusting
	// isPlaying()/isBuffering() before this runs shows stale/wrong state, not reality -
	// confirmed on-device as a stuck buffering spinner AND a play/pause button that
	// silently did nothing (isPlaying() wrongly false, no local _songId/currentTrack to
	// fall back on either, so onPlayPause's branches all missed).
	refreshStatus: function () {
		var self = this;
		if (this._webAudio()) { this._waStatus(); return; }
		this._svc("getStatus", {}, function (response) {
			self.onStatus(response);
			if (self._status.isPlaying) { self._startPolling(); }
		}, this.onSvcFailure);
	},

	// ---- commands --------------------------------------------------------

	load: function (url, songId, libraryId) {
		this.log("load:", url, "song:", songId);
		this._url = url || "";
		this._songId = songId || "";
		this._libraryId = libraryId || "";
	},

	play: function () {
		var self = this;
		this.log("play:", this._songId || this._url);
		if (!this._songId && !this._url) {
			this.log("play called with no songId/url, skipping");
			return;
		}
		// The very first play can beat Lunacy's boot-time probe; wait for its answer so we
		// pick the right backend, then start.
		if (typeof Jukie !== "undefined" && Jukie.whenLunacy && Jukie._lunacy === undefined) {
			Jukie.whenLunacy(function () { self.play(); });
			return;
		}
		if (this._webAudio()) { this._waPlay(); return; }
		// Send play with the loaded track; the service resumes in place only if THIS exact
		// track is the one currently paused, else it plays the new track.
		if (this._songId) {
			// Full-track playback via the Widevine helper (jukie-drm). offlineOnly: with no
			// network the service fails an uncached track at once ("not available offline")
			// instead of waiting out jukie-drm's network timeouts.
			this._svc("play", {
				songId: this._songId, libraryId: this._libraryId,
				offlineOnly: typeof Jukie !== "undefined" && Jukie.online === false
			}, this.onStatus, this.onSvcFailure);
		} else {
			// Preview clip.
			this._svc("play", { url: this._url }, this.onStatus, this.onSvcFailure);
		}
		this._startPolling();
	},

	pause: function () {
		this.log("pause");
		if (this._webAudio()) { this._waPause(); return; }
		this._svc("pause", {}, this.onStatus, this.onSvcFailure);
	},

	resume: function () {
		this.log("resume");
		if (this._webAudio()) { this._waResume(); return; }
		this._svc("resume", {}, this.onStatus, this.onSvcFailure);
		this._startPolling();
	},

	stop: function () {
		this.log("stop");
		if (this._webAudio()) { this._waStop(); return; }
		this._svc("stop", {}, this.onStatus, this.onSvcFailure);
		this._stopPolling();
	},

	// Settings > "Clear Cache". callback(response) gets {returnValue, removed, freedBytes}.
	clearCache: function (callback) {
		this.log("clearCache");
		this._svc("clearCache", {},
			function (response) { this.log("clearCache result:", response); if (callback) { callback(response); } },
			function (response) { if (callback) { callback(response); } });
	},

	// ---- cache size + offline (saved songs) -------------------------------
	// Thin wrappers over the service's cache commands. Every callback receives the raw
	// response ({returnValue:false,...} on failure), so callers must check returnValue.

	setCacheLimit: function (mb, callback) {
		this._svc("setCacheLimit", { mb: mb }, function (r) { if (callback) { callback(r); } },
			function (r) { if (callback) { callback(r || { returnValue: false }); } });
	},

	// -> {limitMB, usedBytes, count, pinnedBytes, pinnedCount}
	getCacheInfo: function (callback) {
		this._svc("getCacheInfo", {}, function (r) { if (callback) { callback(r); } },
			function (r) { if (callback) { callback(r || { returnValue: false }); } });
	},

	// -> {available:[ids], pinned:[ids], missing:[ids], items:[saved-song records]}
	listOffline: function (callback) {
		this._svc("listOffline", {}, function (r) { if (callback) { callback(r); } },
			function (r) { if (callback) { callback(r || { returnValue: false }); } });
	},

	// -> {active:id, queued:[ids], failed:[{id,error}]}
	getOfflineStatus: function (callback) {
		this._svc("getOfflineStatus", {}, function (r) { if (callback) { callback(r); } },
			function (r) { if (callback) { callback(r || { returnValue: false }); } });
	},

	// track: {catalogId, libraryId, title, artist, album, artUrl}
	pinSong: function (track, callback) {
		this._svc("pinSong", {
			songId: track.catalogId, libraryId: track.libraryId || "", title: JukieEmoji.encode(track.title || ""),
			artist: JukieEmoji.encode(track.artist || ""), album: JukieEmoji.encode(track.album || ""), artUrl: track.artUrl || ""
		}, function (r) { if (callback) { callback(r); } },
			function (r) { if (callback) { callback(r || { returnValue: false }); } });
	},

	unpinSong: function (catalogId, callback) {
		this._svc("unpinSong", { songId: catalogId }, function (r) { if (callback) { callback(r); } },
			function (r) { if (callback) { callback(r || { returnValue: false }); } });
	},

	seekTo: function (seconds) {
		// Routed through the Luna service (ffmpeg cuts a fragment from this position, then
		// plays it) - gst-launch itself can't seek a live pipeline.
		this.log("seekTo:", seconds);
		if (this._webAudio()) { this._waSeek(seconds); return; }
		this._svc("seek", { seconds: seconds }, this.onStatus, this.onSvcFailure);
	},

	// ---- synchronous getters (served from cached status) ------------------

	isPlaying: function () { return !!this._status.isPlaying; },
	getCurrentTime: function () { return this._isNumeric(this._status.position) ? this._status.position : 0; },
	getDuration: function () { return this._isNumeric(this._status.duration) ? this._status.duration : 0; },

	// fraction is 0-1 (callers divide a 0-100 slider by 100). This sets OUR OWN PulseAudio
	// stream gain via the service (0-100), not the OS volume. Throttled (trailing-edge).
	setVolume: function (fraction) {
		var pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
		this._status.volume = pct;
		if (this._webAudio()) {
			var wa = this._waState();
			wa.volume = pct / 100;
			if (wa.audio) { wa.audio.volume = wa.volume; }
			return;
		}
		this._pendingVolume = pct;
		var self = this;
		if (this._volumeThrottleTimer) { return; }
		var elapsed = Date.now() - this._lastVolumeSent;
		var wait = Math.max(0, this.VOLUME_THROTTLE_MS - elapsed);
		this._volumeThrottleTimer = setTimeout(function () {
			self._volumeThrottleTimer = null;
			self._lastVolumeSent = Date.now();
			self._svc("setVolume", { volume: self._pendingVolume }, self.onStatus, self.onSvcFailure);
		}, wait);
	},

	// No callback: return last-known cached 0-1 fraction. With callback: force a fresh
	// round-trip (used at startup so a relaunch picks up the running service's volume).
	getVolume: function (callback) {
		var self = this;
		if (this._webAudio()) {
			var v = this._waState().volume;
			if (callback) { callback(v); return; }
			return v;
		}
		if (callback) {
			this._svc("getVolume", {}, function (response) {
				var pct = self._isNumeric(response.volume) ? response.volume : 100;
				self._status.volume = pct;
				callback(pct / 100);
			}, this.onSvcFailure);
			return;
		}
		return (this._isNumeric(this._status.volume) ? this._status.volume : 100) / 100;
	},

	// jukie-drm only ever reads a static secrets.local.json next to itself; this is the
	// only path for Settings-pasted tokens to reach it (the app has no filesystem access).
	setCredentials: function (webDeveloperToken, musicUserToken) {
		this.log("setCredentials");
		this._svc("setCredentials",
			{ webDeveloperToken: webDeveloperToken || "", musicUserToken: musicUserToken || "" },
			function (response) {
				if (!response || response.returnValue === false) {
					this.log("setCredentials failed:", response && response.error);
				}
			},
			function (response) { this.log("setCredentials failed:", response); });
	},

	// ---- service responses + polling -------------------------------------

	onStatus: function (response) {
		if (!response || response.returnValue === false) {
			return;
		}

		this._status = {
			state: response.state || "idle",
			isPlaying: !!response.isPlaying,
			buffering: !!response.buffering,
			position: this._isNumeric(response.position) ? response.position : 0,
			duration: this._isNumeric(response.duration) && response.duration > 0 ? response.duration : 30,
			volume: this._isNumeric(response.volume) ? response.volume : this._status.volume,
			error: response.error || "",
			// True when the service's last jukie-drm spawn failed because the binary
			// wasn't executable on this device (see JukieAudioService.js's own comment) -
			// distinct from a generic playback error so the app can show something
			// actionable instead of "playback error". See _emitTransitions' "error" case.
			permissionError: !!response.permissionError
		};

		this._emitTransitions();

		if (this._status.buffering !== this._prevBuffering) {
			this._prevBuffering = this._status.buffering;
			if (this.onBuffering) { this.onBuffering({ buffering: this._status.buffering }); }
		}

		if (this.onTimeUpdate) { this.onTimeUpdate({ currentTime: this._status.position, duration: this._status.duration }); }
	},

	_emitTransitions: function () {
		var state = this._status.state;

		if (state !== this._prevState) {
			this.log("state:", this._prevState, "->", state);
			switch (state) {
			case "playing":
				if (this.onPlaying) { this.onPlaying(); }
				break;
			case "paused":
				if (this.onPaused) { this.onPaused(); }
				break;
			case "ended":
				if (this.onEnded) { this.onEnded(); }
				this._stopPolling();
				// Auto-advance to the next queued track - mirrors the Enyo sibling app's
				// kindPlayback.onEnded -> nextTrack() (source/app.js's onSongEnd). This
				// port had been missing it entirely: onEnded only ever reset whichever
				// scene's own UI, so a finished track just sat idle instead of moving on.
				// Reaching into the global Jukie singleton from a model file is a
				// deliberate exception (this instance already lives at Jukie.playback) -
				// only ONE onEnded callback can be wired at a time (whichever scene called
				// setup() last), so doing the advance here instead guarantees it fires no
				// matter what's on screen - or if nothing wired the callbacks at all -
				// when a track finishes. Must run AFTER _stopPolling() above: playNext()
				// calls play(), which starts its OWN fresh polling interval, and calling
				// _stopPolling() any later would cancel that new interval, not this one.
				if (typeof Jukie !== "undefined" && Jukie.playNext) {
					var advanced = Jukie.playNext();
					// Tell whichever scene is listening to repaint for the NEW track - see
					// onTrackChanged's own comment in the constructor for why onEnded/
					// onPlaying alone don't cover this.
					if (advanced && this.onTrackChanged) { this.onTrackChanged(); }
				}
				break;
			case "error":
				if (this.onError) { this.onError({ error: this._status.error || "playback error" }); }
				// Reach into the global Jukie singleton directly rather than relying on
				// whichever scene wired up onError - same reasoning as the onEnded/
				// playNext() case above: this has to fire no matter what's on screen (or
				// if nothing wired a callback at all), and only one scene's onError can be
				// wired at a time anyway.
				if (this._status.permissionError && typeof Jukie !== "undefined" && Jukie.showPermissionErrorDialog) {
					Jukie.showPermissionErrorDialog();
				}
				this._stopPolling();
				break;
			}
			this._prevState = state;
		}
	},

	onSvcFailure: function (response) {
		this.log("service call failed:", response);
		if (this.onError) { this.onError({ error: response }); }
		this._stopPolling();
	},

	_startPolling: function () {
		if (this._pollInterval) {
			return;
		}
		var self = this;
		this._pollInterval = setInterval(function () {
			self._svc("getStatus", {}, self.onStatus, self.onSvcFailure);
		}, this._pollRate);
	},

	_stopPolling: function () {
		if (this._pollInterval) {
			clearInterval(this._pollInterval);
			this._pollInterval = null;
		}
	}
};
