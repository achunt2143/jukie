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
		{name: "svcSetCredentials", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "setCredentials", onSuccess: "onCredentialsSet", onFailure: "onCredentialsSet"},
		// Cache size + saved-for-offline songs. All answer through request.callback (see
		// onCallbackResult), same pattern as svcClearCache.
		{name: "svcSetCacheLimit", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "setCacheLimit", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"},
		{name: "svcGetCacheInfo", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "getCacheInfo", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"},
		// Lunacy only: fetch + decrypt a track into the cache, no playback (see _waPlay).
		{name: "svcPrepareSong", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "prepareSong", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"},
		{name: "svcListOffline", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "listOffline", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"},
		{name: "svcGetOfflineStatus", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "getOfflineStatus", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"},
		{name: "svcPinSong", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "pinSong", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"},
		{name: "svcUnpinSong", kind: "PalmService", service: "palm://com.achunt.jukie.service/", method: "unpinSong", onSuccess: "onCallbackResult", onFailure: "onCallbackResult"}
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
		this._waStop();
		this.inherited(arguments);
	},

	// ---- Lunacy: play through the page's own <audio> -----------------------------
	// Lunacy (webOS on Android) has no gst-launch or PulseAudio, so the service can't play
	// anything there. It only fetches (prepareSong: jukie-drm decrypts the track into the
	// cache); this backend reads the cached raw-ADTS file and plays it with an <audio>
	// element. Every state change goes through onStatus() as a synthesized service response,
	// so kindPlayback and everything above it is unchanged. Port of the Mojo build's
	// PlaybackService._wa* (mojo/app/models/playback-service.js - same design notes apply:
	// raw ADTS has no length index, so JukieAdts indexes the frames and a seek hands the
	// element a Blob that starts at the target frame).

	CACHE_URL: "/media/internal/.jukie/cache/",

	_webAudio: function ()
	{
		return JukieLunacy.isLunacy();
	},

	_waState: function ()
	{
		if (!this._wa)
		{
			this._wa = {
				audio: null, token: 0, state: "idle", buffering: false, error: "", permissionError: false,
				bytes: null, index: null, base: 0, durationSec: 0, blobUrl: "", volume: 1, switching: false,
				songId: "", pendingSeek: 0
			};
		}
		return this._wa;
	},

	// Push the current state through onStatus() as if the service had reported it.
	_waStatus: function ()
	{
		var wa = this._waState();
		var pos = wa.base + (wa.audio && wa.audio.src ? (wa.audio.currentTime || 0) : 0);
		if (wa.durationSec > 0) { pos = Math.min(pos, wa.durationSec); }
		this.onStatus(null, {
			returnValue: true,
			state: wa.state,
			// "playing" even while buffering, like the service (the UI shows a spinner for that).
			isPlaying: wa.state === "playing",
			buffering: wa.buffering,
			position: pos,
			duration: wa.durationSec > 0 ? wa.durationSec : 30,
			volume: Math.round(wa.volume * 100),
			error: wa.error,
			permissionError: wa.permissionError
		});
	},

	_waFail: function (msg, permissionError)
	{
		var wa = this._waState();
		wa.state = "error";
		wa.buffering = false;
		wa.error = msg || "playback error";
		wa.permissionError = !!permissionError;
		this._waDrop();
		this._waStatus();
	},

	// Release the current media (element source + blob) without touching state.
	_waDrop: function ()
	{
		var wa = this._waState();
		if (wa.audio)
		{
			wa.switching = true;
			try { wa.audio.pause(); wa.audio.removeAttribute("src"); wa.audio.load(); } catch (e) {}
			wa.switching = false;
		}
		if (wa.blobUrl)
		{
			try { window.URL.revokeObjectURL(wa.blobUrl); } catch (e2) {}
			wa.blobUrl = "";
		}
	},

	_waElement: function ()
	{
		var wa = this._waState();
		if (wa.audio) { return wa.audio; }
		var self = this, a = new window.Audio();
		a.preload = "auto";
		a.volume = wa.volume;
		a.addEventListener("playing", function ()
		{
			wa.state = "playing"; wa.buffering = false; self._waStatus();
		}, false);
		a.addEventListener("waiting", function ()
		{
			if (!wa.switching && wa.state === "playing") { wa.buffering = true; self._waStatus(); }
		}, false);
		a.addEventListener("pause", function ()
		{
			// Swapping the source for a seek also pauses the element; only a real pause counts.
			if (wa.switching || a.ended || wa.state !== "playing") { return; }
			wa.state = "paused"; wa.buffering = false; self._waStatus();
		}, false);
		a.addEventListener("timeupdate", function ()
		{
			if (wa.state === "playing") { self._waStatus(); }
		}, false);
		a.addEventListener("ended", function ()
		{
			wa.state = "ended"; wa.buffering = false; self._waStatus();
		}, false);
		a.addEventListener("error", function ()
		{
			if (wa.switching || !a.src) { return; }
			self._waFail("audio error " + (a.error ? a.error.code : "?"));
		}, false);
		wa.audio = a;
		return a;
	},

	_waPlay: function ()
	{
		var self = this, wa = this._waState(), token = ++wa.token;
		this._waDrop();
		wa.state = "playing";      // optimistic, like the service: UI shows "loading" until audio starts
		wa.buffering = true;
		wa.error = "";
		wa.permissionError = false;
		wa.bytes = null; wa.index = null; wa.base = 0; wa.durationSec = 0;
		this._waStatus();

		if (!this._songId)
		{ // a preview clip: a plain URL, no cache involved
			var a = this._waElement();
			wa.switching = true; a.src = this._url; wa.switching = false;
			a.play();
			return;
		}
		var offlineOnly = !!this._offlineOnly;
		this._cacheCall("svcPrepareSong", {songId: this._songId, libraryId: this._libraryId, offlineOnly: offlineOnly}, function (r)
		{
			if (token !== wa.token) { return; } // skipped / stopped while fetching
			if (!r || r.returnValue === false)
			{
				if (r && r.superseded) { return; }
				self._waFail((r && r.error) || "could not fetch the track", r && r.permissionError);
				return;
			}
			self._waLoad(token, r.durationMs);
		});
	},

	// Read the cached file, index its frames, and start playing (from a seek made before play, if any).
	_waLoad: function (token, durationMs)
	{
		var self = this, wa = this._waState();
		var songId = this._songId;
		var xhr = new window.XMLHttpRequest();
		xhr.open("GET", this.CACHE_URL + encodeURIComponent(songId) + ".m4a", true);
		xhr.responseType = "arraybuffer";
		xhr.onload = function ()
		{
			if (token !== wa.token) { return; }
			if (xhr.status !== 200 && xhr.status !== 0) { self._waFail("could not read the cached track (HTTP " + xhr.status + ")"); return; }
			var bytes = new window.Uint8Array(xhr.response);
			var index = JukieAdts.index(bytes, durationMs);
			if (!index.offsets.length) { self._waFail("the cached track is not playable audio"); return; }
			wa.bytes = bytes; wa.index = index; wa.durationSec = index.durationSec; wa.songId = songId;
			var start = wa.pendingSeek || 0;
			wa.pendingSeek = 0;
			self._waStart(start, true);
		};
		xhr.onerror = function () { if (token === wa.token) { self._waFail("could not read the cached track"); } };
		xhr.send();
	},

	// Point the <audio> at the audio from `seconds` on. autoplay: start it playing.
	_waStart: function (seconds, autoplay)
	{
		var self = this, wa = this._waState();
		if (!wa.bytes || !wa.index) { return; }
		var frame = JukieAdts.frameAt(wa.index, seconds);
		var blob = new window.Blob([wa.bytes.subarray(wa.index.offsets[frame])], {type: "audio/aac"});
		var oldUrl = wa.blobUrl;
		wa.blobUrl = window.URL.createObjectURL(blob);
		wa.base = frame * wa.index.frameSec;
		var a = this._waElement();
		wa.switching = true;
		a.src = wa.blobUrl;
		wa.switching = false;
		if (oldUrl) { try { window.URL.revokeObjectURL(oldUrl); } catch (e) {} }
		if (autoplay)
		{
			var p = a.play();
			if (p && p.catch)
			{
				p.catch(function (e)
				{
					// The browser can refuse audio that didn't start from a tap (the fetch finishes
					// after the tap's own call stack). Fall back to "paused" so the play button
					// works - that tap is a gesture. A real decode problem arrives through the
					// element's error event instead.
					if (e && e.name === "NotAllowedError" && wa.state === "playing")
					{
						wa.state = "paused"; wa.buffering = false; self._waStatus();
					}
				});
			}
		}
		else
		{
			wa.buffering = false;
			this._waStatus();
		}
	},

	_waPause: function ()
	{
		var wa = this._waState();
		if (!wa.audio || wa.state !== "playing") { return; }
		wa.state = "paused"; wa.buffering = false;
		wa.audio.pause();
		this._waStatus();
	},

	_waResume: function ()
	{
		var wa = this._waState();
		wa.state = "playing";
		wa.audio.play();
		this._waStatus();
	},

	_waStop: function ()
	{
		var wa = this._waState();
		wa.token++;
		this._waDrop();
		wa.state = "idle"; wa.buffering = false; wa.error = ""; wa.base = 0; wa.songId = "";
		this._waStatus();
	},

	_waSeek: function (seconds)
	{
		var wa = this._waState();
		if (!wa.bytes)
		{
			wa.pendingSeek = seconds; // kindPlayback seeks right after load(), before play()
			return;
		}
		this._waStart(seconds, wa.state === "playing");
	},

	// ---- commands from kindPlayback --------------------------------------

	load: function (url, songId, libraryId)
	{
		this.log("load:", url, "song:", songId);
		this._url = url || "";
		this._songId = songId || "";
		this._libraryId = libraryId || "";
		this._waState().pendingSeek = 0;
	},

	play: function ()
	{
		var self = this;
		this.log("play:", this._songId || this._url);
		if (!this._songId && !this._url)
		{
			this.log("play called with no songId/url, skipping");
			return;
		}
		// The very first play can beat Lunacy's boot-time probe; wait for its answer so we
		// pick the right backend, then start.
		if (JukieLunacy.state === undefined)
		{
			JukieLunacy.whenKnown(function () { self.play(); });
			return;
		}
		if (this._webAudio())
		{
			// Same rule as the service: resume in place only if THIS exact track is the one
			// currently paused; otherwise (new track, ended, failed) start it fresh.
			var wa = this._waState();
			if (wa.state === "paused" && this._songId && wa.songId === this._songId && wa.audio && wa.audio.src)
			{
				this._waResume();
			}
			else
			{
				this._waPlay();
			}
			return;
		}
		// Always send play with the loaded track; the service resumes in place only if
		// THIS exact track is the one currently paused, otherwise it plays the new track.
		// (Deciding resume here was wrong: skipping/selecting while paused resumed the old
		// song instead of starting the newly-loaded one.)
		if (this._songId)
		{
			// Full-track playback via the Widevine helper (jukie-drm). offlineOnly: with no
			// network the service fails an uncached track at once ("not available offline")
			// instead of waiting out jukie-drm's network timeouts.
			this.$.svcPlay.call({songId: this._songId, libraryId: this._libraryId, offlineOnly: !!this._offlineOnly});
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
		if (this._webAudio()) { this._waPause(); return; }
		this.$.svcPause.call({});
	},

	stop: function ()
	{
		this.log("stop");
		if (this._webAudio()) { this._waStop(); return; }
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

	// ---- cache size + saved-for-offline songs -----------------------------
	// Every callback gets the raw response ({returnValue:false,...} on failure), so callers
	// must check returnValue.

	// When true, play() tells the service not to bother fetching an uncached track.
	setOfflineOnly: function (offlineOnly)
	{
		this._offlineOnly = !!offlineOnly;
	},

	_cacheCall: function (name, params, callback)
	{
		var req = this.$[name].call(params || {});
		req.callback = callback;
	},

	onCallbackResult: function (sender, response, request)
	{
		if (request && request.callback) { request.callback(response || {returnValue: false}); }
	},

	setCacheLimit: function (mb, callback)
	{
		this._cacheCall("svcSetCacheLimit", {mb: mb}, callback);
	},

	// -> {limitMB, usedBytes, count, pinnedBytes, pinnedCount}
	getCacheInfo: function (callback)
	{
		this._cacheCall("svcGetCacheInfo", {}, callback);
	},

	// -> {available:[ids], pinned:[ids], missing:[ids], items:[saved-song records]}
	listOffline: function (callback)
	{
		this._cacheCall("svcListOffline", {}, callback);
	},

	// -> {active:id, queued:[ids], failed:[{id,error}]}
	getOfflineStatus: function (callback)
	{
		this._cacheCall("svcGetOfflineStatus", {}, callback);
	},

	// item: a playlist/library item {id, libraryId, title, artist, album, artUrl}
	pinSong: function (item, callback)
	{
		this._cacheCall("svcPinSong", {
			songId: item.id, libraryId: item.libraryId || "", title: JukieEmoji.encode(item.title || ""), // emoji sent as ASCII markers: Luna replies from the service cannot carry real ones (see JukieEmoji)
			artist: JukieEmoji.encode(item.artist || ""), album: JukieEmoji.encode(item.album || ""), artUrl: item.artUrl || ""
		}, callback);
	},

	unpinSong: function (songId, callback)
	{
		this._cacheCall("svcUnpinSong", {songId: songId}, callback);
	},

	seekTo: function (seconds)
	{
		// Routed through the Luna service (ffmpeg cuts a fragment starting at this position,
		// then plays it) - see JukieAudioService.js's seekTo/_runSeek for why gst-launch
		// itself can't seek a live pipeline.
		this.log("seekTo:", seconds);
		if (this._webAudio()) { this._waSeek(seconds); return; }
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
		if (this._webAudio())
		{
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
		if (this._webAudio())
		{
			var v = this._waState().volume;
			if (callback) { callback(v); return; }
			return v;
		}
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
