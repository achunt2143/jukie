/*globals enyo, $L, Utilities, window */
enyo.kind({
	name: "ExhibitionApp",
	kind: "VFlexBox",
	className: "enyo-fit jukieExhibition",
	components: [
		{ name: "appEvent", kind: "ApplicationEvents", onWindowParamsChange: "windowParamsChangeHandler", onUnload: "unloadHandler" },

		// Standalone-playback engine + session store, used ONLY when Jukie's main window
		// isn't running (docked while the app is closed). When the main window IS running,
		// Exhibition stays a passive display driven by pushes and this engine lies dormant
		// (it never touches the service unless we call setPlaybackList on it), so there's
		// never a two-driver conflict. See _decideMode / _startStandalone.
		{ name: "Session", kind: "kindPlaybackSession" },
		{ name: "Playback", kind: "kindPlayback",
			onTrackSrcChanged: "onEngineTrackSrcChanged",
			onUpdateTrackTime: "onEngineUpdateTrackTime",
			onTrackPausePlay: "onEngineTrackPausePlay",
			onSongEnd: "onEngineSongEnd" },

		{ name: "art", kind: "Control", className: "exh-art" },
		{ kind: "Control", className: "exh-scrim" },

		{ kind: "VFlexBox", className: "exh-content", components: [
			{ kind: "HFlexBox", pack: "end", components: [
				{ name: "lblClock", kind: "Control", className: "exh-clock" }
			]},
			{ flex: 1 },
			{ kind: "VFlexBox", className: "exh-bottom", components: [
				{ name: "lblAlbum", kind: "Control", className: "exh-album" },
				{ name: "lblTitle", kind: "Control", className: "exh-title" },
				{ name: "lblArtist", kind: "Control", className: "exh-artist" },
				{ kind: "HFlexBox", className: "exh-timerow", components: [
					{ name: "lblElapsed", kind: "Control", className: "exh-time" },
					{ flex: 1 },
					{ name: "lblDuration", kind: "Control", className: "exh-time" }
				]},
				{ kind: "HFlexBox", pack: "center", className: "exh-transport", components: [
					{ name: "btnPrev", kind: "IconButton", className: "exh-btn prev", icon: "images/btn_dashboard_prev.png", onclick: "onclick_prev" },
					{ name: "btnPlay", kind: "IconButton", className: "exh-btn play paused", icon: "images/btn_dashboard_play.png", label: " ", onclick: "onclick_playpause" },
					{ name: "btnNext", kind: "IconButton", className: "exh-btn next", icon: "images/btn_dashboard_next.png", onclick: "onclick_next" }
				]}
			]}
		]}
	],

	MAIN_WINDOW_NAME: "com.achunt.jukie",
	_clockTimer: null,

	// Elapsed-time model - see the long note below. Wall-clock derived so it can't jitter.
	_baseElapsed: 0,
	_baseAt: 0,
	_duration: 0,
	_playing: false,

	// true when we're the standalone engine (Jukie main window not running).
	_standalone: false,
	_progressSaveAt: 0,
	PROGRESS_SAVE_MS: 7000,

	create: function ()
	{
		this.inherited(arguments);
		this.log();
		this._baseAt = Date.now();
		this._tickClock();
		this._clockTimer = window.setInterval(enyo.bind(this, "_onTick"), 1000);
		this._decideMode();
	},

	// Passive (main running) vs. standalone (main not running).
	_decideMode: function ()
	{
		var winMain = enyo.windows.fetchWindow(this.MAIN_WINDOW_NAME);
		if (winMain)
		{
			// Passive: mirror the live app via pushes.
			this._standalone = false;
			this.requestSync();
			if (enyo.windowParams)
			{
				this._applyWindowParams(enyo.windowParams);
			}
		}
		else
		{
			// Standalone: Jukie isn't running, so resume the last session ourselves.
			this._standalone = true;
			this._startStandalone();
		}
	},

	_startStandalone: function ()
	{
		var self = this;
		this.$.Session.load().then(function (session)
		{
			if (!session)
			{
				self.log("standalone: no saved session to resume");
				return;
			}
			// Resume: load the saved queue at the saved track + position and start playing.
			// (User intent is "start playing from where we left off", so we auto-play even
			// if the session was paused when saved.) A fixed non-empty originListID makes
			// kindPlaybackList treat this as a fresh list to load (it compares against its
			// initial "", and an equal id would skip the load and just switch tracks).
			var objSetPlaybackList = {
				arSetPlaybackList: session.queue,
				intStartTrackIndex: session.index || 0,
				intStartTrackTime: session.position || 0,
				strOriginListID: "exhresume",
				strListQuery: session.listQuery || "{}"
			};
			try
			{
				self.$.Playback.setPlaybackList(objSetPlaybackList);
				self.$.Playback.setRepeatMode(session.repeat || 0);
			}
			catch (err)
			{
				self.log("standalone resume failed:", err);
			}
		});
	},

	unloadHandler: function ()
	{
		this.log();
		if (this._standalone)
		{
			this._saveProgressNow();
		}
		if (this._clockTimer !== null)
		{
			window.clearInterval(this._clockTimer);
			this._clockTimer = null;
		}
	},

	// ---- passive-mode plumbing (main window running) ----------------------

	requestSync: function ()
	{
		this.log();
		var winMain = enyo.windows.fetchWindow(this.MAIN_WINDOW_NAME);
		if (winMain)
		{
			enyo.windows.setWindowParams(winMain, { requestExhibitionSync: true });
		}
	},

	windowParamsChangeHandler: function ()
	{
		this.log();
		this._applyWindowParams(enyo.windowParams);
	},

	_applyWindowParams: function (params)
	{
		if (!params || this._standalone)
		{
			return;
		}
		if (params.objTrackInfo)
		{
			this.updateTrackInfoDisplay(params.objTrackInfo);
		}
		if (params.boolAudioPlaying !== undefined)
		{
			this.setPlayPause(params.boolAudioPlaying);
		}
		if (params.objTrackTimes)
		{
			this.updateTrackTimeDisplay(params.objTrackTimes);
		}
	},

	// ---- standalone-mode engine events (Jukie main not running) -----------
	// These fire on OUR own kindPlayback and route into the exact same display methods the
	// passive pushes use, so the UI code is shared. Guarded by _standalone for the saves.

	onEngineTrackSrcChanged: function (sender, objTrackInfo)
	{
		this.updateTrackInfoDisplay(objTrackInfo);
		if (this._standalone) { this._saveProgressNow(); }
	},

	onEngineUpdateTrackTime: function (sender, objTrackTimes)
	{
		this.updateTrackTimeDisplay(objTrackTimes);
	},

	onEngineTrackPausePlay: function (sender, boolAudioPlaying)
	{
		this.setPlayPause(boolAudioPlaying);
		if (this._standalone) { this._saveProgressNow(); }
	},

	onEngineSongEnd: function ()
	{
		// Advance to the next track in the resumed queue.
		this.$.Playback.nextTrack();
	},

	_saveProgressNow: function ()
	{
		try
		{
			this._progressSaveAt = Date.now();
			var snap = this.$.Playback.getSessionSnapshot();
			this.$.Session.saveProgress(snap.index, snap.position, snap.playing);
		}
		catch (err)
		{
			this.log("saveProgress error:", err);
		}
	},

	_maybeSaveProgress: function ()
	{
		if (Date.now() - this._progressSaveAt < this.PROGRESS_SAVE_MS) { return; }
		this._saveProgressNow();
	},

	// ---- shared display ---------------------------------------------------

	updateTrackInfoDisplay: function (objTrackInfo)
	{
		this.log();
		this.$.lblTitle.setContent(objTrackInfo.strTrackTitle || "");
		this.$.lblArtist.setContent(objTrackInfo.strTrackArtist || "");
		this.$.lblAlbum.setContent(objTrackInfo.strTrackAlbum || "");
		if (objTrackInfo.strTrackImage)
		{
			this.$.art.applyStyle("background-image", "url(" + objTrackInfo.strTrackImage + ")");
		}
		this._duration = this._num(objTrackInfo.intTrackDuration, this._duration);
		this._rebase(this._num(objTrackInfo.intTrackTime, 0));
		this._renderTime();
	},

	updateTrackTimeDisplay: function (objTrackTimes)
	{
		this._duration = this._num(objTrackTimes.floatTrackDuration, this._duration);
		var pushed = this._num(objTrackTimes.floatTrackCurrentTime, this._currentElapsed());
		var cur = this._currentElapsed();
		// Ignore small backward jitter; accept forward progress and large jumps.
		if (!(pushed < cur - 1.5 && (cur - pushed) < 5))
		{
			this._rebase(pushed);
		}
		this._renderTime();
	},

	setPlayPause: function (boolAudioPlaying)
	{
		this.log(boolAudioPlaying);
		this._rebase(this._currentElapsed());
		this._playing = !!boolAudioPlaying;
		this.$.btnPlay.addRemoveClass("paused", !boolAudioPlaying);
	},

	// ---- elapsed helpers (wall-clock model; see original note) ------------

	_rebase: function (seconds)
	{
		this._baseElapsed = seconds;
		this._baseAt = Date.now();
	},

	_currentElapsed: function ()
	{
		var e = this._baseElapsed;
		if (this._playing)
		{
			e += (Date.now() - this._baseAt) / 1000;
		}
		if (this._duration > 0 && e > this._duration)
		{
			e = this._duration;
		}
		return (e < 0) ? 0 : e;
	},

	_renderTime: function ()
	{
		this.$.lblElapsed.setContent(Utilities.formatTime(this._currentElapsed()));
		this.$.lblDuration.setContent(Utilities.formatTime(this._duration));
	},

	_num: function (v, fallback)
	{
		var n = Number(v);
		return (isNaN(n) || n < 0) ? fallback : n;
	},

	_onTick: function ()
	{
		this._tickClock();
		this._renderTime();
		if (this._standalone) { this._maybeSaveProgress(); }
	},

	_tickClock: function ()
	{
		var d = new Date();
		var h = d.getHours();
		var ampm = (h >= 12) ? "PM" : "AM";
		h = h % 12;
		if (h === 0)
		{
			h = 12;
		}
		var strMin = (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
		this.$.lblClock.setContent(h + ":" + strMin + " " + ampm);
	},

	// ---- transport --------------------------------------------------------
	// Standalone: drive our own engine (mirrors app.js's onClickPrev/PlayPause/Next).
	// Passive: forward the command to the running main window (its processDashCommand).

	sendCommand: function (cmdType)
	{
		this.log(cmdType);
		var winMain = enyo.windows.fetchWindow(this.MAIN_WINDOW_NAME);
		if (winMain)
		{
			enyo.windows.setWindowParams(winMain, { cmdType: cmdType });
		}
	},

	onclick_prev: function ()
	{
		if (this._standalone) { this.$.Playback.prevTrack(true); }
		else { this.sendCommand("prev"); }
	},

	onclick_playpause: function ()
	{
		if (this._standalone) { this.$.Playback.pausePlayback(); }
		else { this.sendCommand("playpause"); }
	},

	onclick_next: function ()
	{
		if (this._standalone) { this.$.Playback.nextTrack(true); }
		else { this.sendCommand("next"); }
	}
});
