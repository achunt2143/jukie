/*globals enyo, window, setTimeout, clearInterval, setInterval, Utilities */
/*
 * kindAudioPlayer
 *
 * Drives playback through the bundled GStreamer-backed Luna service
 * (com.achunt.jukie.service) instead of an HTML5 <audio> element. On this
 * webOS build, <audio> routes through a playbin pipeline that is missing the
 * "audioresample" element and stalls forever; the service spawns a working
 * hand-built pipeline (decodebin -> pulsesink) instead. See the project memo
 * "playback-audioresample-blocker" for the full diagnosis.
 *
 * The public surface (load/play/pause/seekTo/isPlaying/getCurrentTime/
 * getDuration/setVolume/getVolume + onTimeUpdate/onPlaying/onPaused/onEnded/
 * onError) is unchanged, so kindPlayback needs no edits. Playback state is
 * pulled from the service by polling getStatus while active; sync getters
 * return the most recent cached status.
 */
enyo.kind(
{
	name: "kindAudioPlayer",
	kind: "Component",
	events: {onTimeUpdate: "", onPlaying: "", onPaused: "", onEnded: "", onError: "", onBuffering: ""},
	components: [
		{name: "svcPlay", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "play", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcPause", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "pause", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcResume", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "resume", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcStop", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "stop", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcStatus", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "getStatus", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcClearCache", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "clearCache", onSuccess: "onClearCacheResult", onFailure: "onClearCacheResult"},
		{name: "svcSeek", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "seek", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcSetVolume", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "setVolume", onSuccess: "onStatus", onFailure: "onSvcFailure"},
		{name: "svcGetVolume", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "getVolume", onSuccess: "onGotVolume", onFailure: "onSvcFailure"},
		{name: "svcSetCredentials", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "setCredentials", onSuccess: "onCredentialsSet", onFailure: "onCredentialsSet"}
	],

	_url: "",
	_pollInterval: null,
	_pollRate: 500,
	_volumeThrottleTimer: null,
	_pendingVolume: null,
	_lastVolumeSent: 0,
	VOLUME_THROTTLE_MS: 100,

	create: function ()
	{
		this.inherited(arguments);
		this._status = {state: "idle", isPlaying: false, position: 0, duration: 30, volume: 100};
		this._prevState = "idle";
		this._prevBuffering = false;
	},

	isBuffering: function ()
	{
		return !!this._status.buffering;
	},

	destroy: function ()
	{
		this._stopPolling();
		this.inherited(arguments);
	},

	// ---- commands from kindPlayback --------------------------------------

	load: function (url, songId, libraryId)
	{
		this.log("load:", url, "song:", songId);
		this._url = url || "";
		this._songId = songId || "";
		this._libraryId = libraryId || "";
	},

	play: function ()
	{
		this.log("play:", this._songId || this._url);
		if (!this._songId && !this._url)
		{
			this.log("play called with no songId/url, skipping");
			return;
		}
		// Always send play with the loaded track; the service resumes in place only if
		// THIS exact track is the one currently paused, otherwise it plays the new track.
		// (Deciding resume here was wrong: skipping/selecting while paused resumed the old
		// song instead of starting the newly-loaded one.)
		if (this._songId)
		{
			// Full-track playback via the Widevine helper (jukie-drm).
			this.$.svcPlay.call({songId: this._songId, libraryId: this._libraryId});
		}
		else
		{
			// Preview clip.
			this.$.svcPlay.call({url: this._url});
		}
		this._startPolling();
	},

	pause: function ()
	{
		this.log("pause");
		this.$.svcPause.call({});
	},

	stop: function ()
	{
		this.log("stop");
		this.$.svcStop.call({});
		this._stopPolling();
	},

	// Settings > "Clear Cache". Separate from the cache on/off toggle - clearing the
	// downloaded tracks shouldn't require disabling caching itself. callback(response)
	// gets {returnValue, removed, freedBytes} (or an error response on failure).
	clearCache: function (callback)
	{
		this.log("clearCache");
		var req = this.$.svcClearCache.call({});
		req.callback = callback;
	},

	onClearCacheResult: function (sender, response, request)
	{
		this.log("clearCache result:", response);
		if (request && request.callback) { request.callback(response); }
	},

	seekTo: function (seconds)
	{
		// Routed through the Luna service (ffmpeg cuts a fragment starting at this position,
		// then plays it) - see JukieAudioService.js's seekTo/_runSeek for why gst-launch
		// itself can't seek a live pipeline.
		this.log("seekTo:", seconds);
		this.$.svcSeek.call({seconds: seconds});
	},

	// ---- synchronous getters (served from cached status) ------------------

	isPlaying: function ()
	{
		return !!this._status.isPlaying;
	},

	getCurrentTime: function ()
	{
		return Utilities.isNumeric(this._status.position) ? this._status.position : 0;
	},

	getDuration: function ()
	{
		return Utilities.isNumeric(this._status.duration) ? this._status.duration : 0;
	},

	// value is a 0-1 fraction (kindPlayback's existing convention - it divides the slider's
	// 0-100 position by 100 before calling this). This sets OUR OWN PulseAudio stream gain
	// via the Luna service (which speaks 0-100), not the real OS volume - com.palm.audio's
	// setVolume is private-bus-only and unreachable from a 3rd-party app (confirmed via live
	// device testing), so there is no way to move the actual system-wide volume from here.
	// See JukieAudioService.js's setVolume/_applyVolume for how the gain is actually applied.
	//
	// Throttled (trailing-edge) the same way alphapicker.js throttles its list-jump: a drag
	// fires this continuously, and an un-throttled Luna call per tick would spawn a `pactl
	// list sink-inputs` + `pactl set-sink-input-volume` pair per tick, piling up process
	// spawns on this device faster than they complete.
	setVolume: function (fraction)
	{
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
			self.$.svcSetVolume.call({volume: self._pendingVolume});
		}, wait);
	},

	// Synchronous form returns the last-known cached value as a 0-1 fraction (matches
	// setVolume's input convention). Pass a callback (receives a 0-1 fraction) to force a
	// fresh round-trip to the service instead - used once at startup (see app.js's
	// onRequestSysVolume) so a relaunch picks up whatever volume the still-running service
	// was last set to, rather than assuming the default.
	getVolume: function (callback)
	{
		if (callback)
		{
			var req = this.$.svcGetVolume.call({});
			req.callback = callback;
			return;
		}
		return (Utilities.isNumeric(this._status.volume) ? this._status.volume : 100) / 100;
	},

	onGotVolume: function (sender, response, request)
	{
		var pct = Utilities.isNumeric(response.volume) ? response.volume : 100;
		this._status.volume = pct;
		if (request && request.callback) { request.callback(pct / 100); }
	},

	// jukie-drm (the full-track/Widevine helper) only ever reads a static
	// secrets.local.json next to itself - it has no way to receive tokens per
	// invocation. This is the only path for a Developer Token / Music User Token
	// pasted into Settings to actually reach it, since the app has no filesystem
	// access of its own. See JukieAudioService.js's setCredentials.
	setCredentials: function (webDeveloperToken, musicUserToken)
	{
		this.log("setCredentials");
		this.$.svcSetCredentials.call({webDeveloperToken: webDeveloperToken || "", musicUserToken: musicUserToken || ""});
	},

	// Deliberately NOT routed through onStatus/onSvcFailure: this response has no
	// state/position/etc fields, and onSvcFailure fires doError()/stops polling - wrong
	// side effects for what's just a credentials-file write succeeding or failing.
	onCredentialsSet: function (sender, response)
	{
		if (!response || response.returnValue === false)
		{
			this.log("setCredentials failed:", response && response.error);
		}
	},

	// ---- service responses + polling -------------------------------------

	onStatus: function (sender, response)
	{
		if (!response || response.returnValue === false)
		{
			return;
		}

		this._status = {
			state: response.state || "idle",
			isPlaying: !!response.isPlaying,
			buffering: !!response.buffering,
			position: Utilities.isNumeric(response.position) ? response.position : 0,
			duration: Utilities.isNumeric(response.duration) && response.duration > 0 ? response.duration : 30,
			volume: Utilities.isNumeric(response.volume) ? response.volume : this._status.volume,
			error: response.error || "",
			// True when the service's last jukie-drm spawn failed because the binary
			// wasn't executable on this device (see JukieAudioService.js's own comment) -
			// distinct from a generic playback error so the app can show something
			// actionable. Bubbled up through doError's payload below.
			permissionError: !!response.permissionError
		};

		this._emitTransitions();

		if (this._status.buffering !== this._prevBuffering)
		{
			this._prevBuffering = this._status.buffering;
			this.doBuffering({buffering: this._status.buffering});
		}

		this.doTimeUpdate({currentTime: this._status.position, duration: this._status.duration});
	},

	_emitTransitions: function ()
	{
		var state = this._status.state;

		if (state !== this._prevState)
		{
			this.log("state:", this._prevState, "->", state);
			switch (state)
			{
			case "playing":
				this.doPlaying();
				break;
			case "paused":
				this.doPaused();
				break;
			case "ended":
				this.doEnded();
				this._stopPolling();
				break;
			case "error":
				this.doError({error: this._status.error || "playback error", permissionError: this._status.permissionError});
				this._stopPolling();
				break;
			}
			this._prevState = state;
		}
	},

	onSvcFailure: function (sender, response)
	{
		this.log("service call failed:", enyo.json ? enyo.json.stringify(response) : response);
		this.doError({error: response});
		this._stopPolling();
	},

	_startPolling: function ()
	{
		if (this._pollInterval)
		{
			return;
		}
		var self = this;
		this._pollInterval = setInterval(function () {
			self.$.svcStatus.call({});
		}, this._pollRate);
	},

	_stopPolling: function ()
	{
		if (this._pollInterval)
		{
			clearInterval(this._pollInterval);
			this._pollInterval = null;
		}
	}
});
