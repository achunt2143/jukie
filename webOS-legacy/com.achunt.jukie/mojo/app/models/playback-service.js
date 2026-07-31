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

	destroy: function () { this._stopPolling(); },

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
		this.log("play:", this._songId || this._url);
		if (!this._songId && !this._url) {
			this.log("play called with no songId/url, skipping");
			return;
		}
		// Send play with the loaded track; the service resumes in place only if THIS exact
		// track is the one currently paused, else it plays the new track.
		if (this._songId) {
			// Full-track playback via the Widevine helper (jukie-drm).
			this._svc("play", { songId: this._songId, libraryId: this._libraryId }, this.onStatus, this.onSvcFailure);
		} else {
			// Preview clip.
			this._svc("play", { url: this._url }, this.onStatus, this.onSvcFailure);
		}
		this._startPolling();
	},

	pause: function () {
		this.log("pause");
		this._svc("pause", {}, this.onStatus, this.onSvcFailure);
	},

	resume: function () {
		this.log("resume");
		this._svc("resume", {}, this.onStatus, this.onSvcFailure);
		this._startPolling();
	},

	stop: function () {
		this.log("stop");
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

	seekTo: function (seconds) {
		// Routed through the Luna service (ffmpeg cuts a fragment from this position, then
		// plays it) - gst-launch itself can't seek a live pipeline.
		this.log("seekTo:", seconds);
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
