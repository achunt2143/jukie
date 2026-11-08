/*globals enyo, $L, Utilities, JukieLyrics, JukieEmoji, window, document */
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

		{ name: "Settings", kind: "kindSettings" },
		{ name: "DB8", kind: "kindDB8" },
		{ name: "AppleMusicService", kind: "AppleMusicService",
			developerToken: window.APPLE_MUSIC_DEVELOPER_TOKEN || "",
			musicUserToken: window.APPLE_MUSIC_USER_TOKEN || "",
			storefront: "us", debug: false },

		{ name: "art", kind: "Control", className: "exh-art" },
		{ kind: "Control", className: "exh-scrim" },

		{ kind: "VFlexBox", className: "exh-content", components: [
			{ kind: "HFlexBox", pack: "end", components: [
				{ name: "lblClock", kind: "Control", className: "exh-clock" }
			]},
			{ flex: 1 },
			{ kind: "VFlexBox", className: "exh-bottom", components: [
				{ name: "exhTrackInfo", kind: "VFlexBox", className: "exh-track-info", onclick: "onclick_trackInfo", components: [
					{ name: "lblAlbum", kind: "Control", className: "exh-album" },
					{ name: "lblTitle", kind: "Control", className: "exh-title" },
					{ name: "lblArtist", kind: "Control", className: "exh-artist" },
					{ kind: "HFlexBox", className: "exh-timerow", components: [
						{ name: "lblElapsed", kind: "Control", className: "exh-time" },
						{ flex: 1 },
						{ name: "lblDuration", kind: "Control", className: "exh-time" }
					]}
				]},
				{ kind: "HFlexBox", pack: "center", className: "exh-transport", components: [
					{ name: "btnPrev", kind: "IconButton", className: "exh-btn prev", icon: "images/btn_dashboard_prev.png", onclick: "onclick_prev" },
					{ name: "btnPlay", kind: "IconButton", className: "exh-btn play paused", icon: "images/btn_dashboard_play.png", label: " ", onclick: "onclick_playpause" },
					{ name: "btnNext", kind: "IconButton", className: "exh-btn next", icon: "images/btn_dashboard_next.png", onclick: "onclick_next" }
				]}
			]}
		]},

		// Lyrics panel: on the right half, positioned between clock and transport controls
		{ name: "exhLyricsPanel", kind: "VFlexBox", className: "exh-lyrics-panel", showing: false, components: [
			{ name: "exhLyricsHeader", kind: "HFlexBox", className: "exh-lyrics-header", align: "center", components: [
				{ name: "exhLyricsTitle", kind: "Control", className: "exh-lyrics-title", content: $L("Lyrics"), flex: 1 }
			]},
			{ name: "exhLyricsScroller", kind: "Scroller", className: "exh-lyrics-scroller", flex: 1, autoHorizontal: false, horizontal: false, autoVertical: true, components: [
				{ name: "exhLyricsList", className: "exh-lyrics-list", allowHtml: true, onclick: "onclick_lyricsList" }
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

	_lyrics: null,
	_lyricsSongId: null,
	_lyricsState: "idle",
	_showingLyrics: false,
	_activeLyricIdx: -1,
	_lastLyricsPos: 0,
	_trackInfo: null,

	create: function ()
	{
		this.inherited(arguments);
		this.log();
		this._baseAt = Date.now();
		this._tickClock();
		this._clockTimer = window.setInterval(enyo.bind(this, "_onTick"), 1000);

		this.$.Settings.setDb8(this.$.DB8);
		var self = this;
		this.$.Settings.load().then(function (s)
		{
			if (s)
			{
				if (s.musicUserToken) { self.$.AppleMusicService.setMusicUserToken(s.musicUserToken); }
				if (s.developerToken) { self.$.AppleMusicService.setDeveloperToken(s.developerToken); }
			}
			self.$.AppleMusicService.ensureDeveloperToken();
		});

		var savedToggled = false;
		try { savedToggled = (localStorage.getItem("jukie_lyrics_toggled") === "1"); } catch (e) {}
		this.setLyricsShowing(savedToggled);

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
		if (params.boolLyricsShowing !== undefined)
		{
			this.setLyricsShowing(params.boolLyricsShowing);
		}
		if (params.objLyrics)
		{
			this._lyrics = params.objLyrics;
			this._lyricsSongId = params.strLyricsSongId || this._lyricsSongId;
			this._lyricsState = "loaded";
			this.renderLyrics();
			if (this._lastLyricsPos !== undefined)
			{
				this.updateLyricsTime(this._lastLyricsPos);
			}
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
		this._trackInfo = objTrackInfo;
		JukieEmoji.setContent(this.$.lblTitle, objTrackInfo.strTrackTitle || "");
		JukieEmoji.setContent(this.$.lblArtist, objTrackInfo.strTrackArtist || "");
		JukieEmoji.setContent(this.$.lblAlbum, objTrackInfo.strTrackAlbum || "");
		if (objTrackInfo.strTrackImage)
		{
			this.$.art.applyStyle("background-image", "url(" + objTrackInfo.strTrackImage + ")");
		}
		this._duration = this._num(objTrackInfo.intTrackDuration, this._duration);
		this._rebase(this._num(objTrackInfo.intTrackTime, 0));
		this._renderTime();

		this.loadLyrics(objTrackInfo);
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
		this.updateLyricsTime(this._currentElapsed());
	},

	setPlayPause: function (boolAudioPlaying)
	{
		this.log(boolAudioPlaying);
		this._rebase(this._currentElapsed());
		this._playing = !!boolAudioPlaying;
		this.$.btnPlay.addRemoveClass("paused", !boolAudioPlaying);
	},

	// ---- elapsed helpers (wall-clock model) --------------------------------

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
		this.updateLyricsTime(this._currentElapsed());
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

	sendCommand: function (cmdType, extraParams)
	{
		this.log(cmdType);
		var winMain = enyo.windows.fetchWindow(this.MAIN_WINDOW_NAME);
		if (winMain)
		{
			var p = { cmdType: cmdType };
			if (extraParams)
			{
				for (var k in extraParams)
				{
					if (extraParams.hasOwnProperty(k))
					{
						p[k] = extraParams[k];
					}
				}
			}
			enyo.windows.setWindowParams(winMain, p);
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
	},

	// ---- lyrics support ---------------------------------------------------

	setLyricsShowing: function (boolShowing)
	{
		this._showingLyrics = !!boolShowing;
		try { localStorage.setItem("jukie_lyrics_toggled", this._showingLyrics ? "1" : "0"); } catch (e) {}
		if (this.$.exhLyricsPanel)
		{
			this.$.exhLyricsPanel.setShowing(this._showingLyrics);
		}
		this.addRemoveClass("has-lyrics", this._showingLyrics);
		if (this._showingLyrics)
		{
			if (this._lyricsState === "loaded" && this._lyrics)
			{
				this.renderLyrics();
				if (this._lastLyricsPos !== undefined)
				{
					this.updateLyricsTime(this._lastLyricsPos);
				}
			}
			else
			{
				this.loadLyrics(this._trackInfo);
			}
		}
	},

	onclick_toggleLyrics: function ()
	{
		this.setLyricsShowing(!this._showingLyrics);
	},

	onclick_trackInfo: function ()
	{
		if (!this._showingLyrics)
		{
			this.setLyricsShowing(true);
		}
	},

	_getTrackSongId: function (track)
	{
		if (!track) { return null; }
		if (typeof track === "string" || typeof track === "number")
		{
			return "" + track;
		}
		var id = track.catalogId || track.id || track.strTrackID;
		return id ? ("" + id) : null;
	},

	loadLyrics: function (track)
	{
		var t = (track && typeof track === "object") ? track : this._trackInfo;
		var songId = this._getTrackSongId(t);

		if (!songId)
		{
			this._lyrics = null;
			this._lyricsSongId = null;
			this._lyricsState = "unavailable";
			this._activeLyricIdx = -1;
			this._renderLyricsUnavailable();
			return;
		}

		if (this._lyricsSongId === songId)
		{
			if (this._lyricsState === "loaded" && this._lyrics)
			{
				this.renderLyrics();
				if (this._lastLyricsPos !== undefined)
				{
					this.updateLyricsTime(this._lastLyricsPos);
				}
				return;
			}
			else if (this._lyricsState === "unavailable")
			{
				this._renderLyricsUnavailable();
				return;
			}
			else if (this._lyricsState === "loading")
			{
				return;
			}
		}

		this._lyricsSongId = songId;
		this._lyricsState = "loading";
		this._lyrics = null;
		this._activeLyricIdx = -1;
		this._renderLyricsEmpty($L("Loading lyrics…"));

		if (!this.$.AppleMusicService)
		{
			this._onLyricsUnavailable(songId);
			return;
		}

		var self = this;
		this.$.AppleMusicService.getLyrics(songId, { syllable: false }).then(function (res)
		{
			if (self._lyricsSongId !== songId) { return; }
			var ttml = JukieLyrics.extractTTML(res);
			if (!ttml)
			{
				self._onLyricsUnavailable(songId);
				return;
			}
			var parsed = JukieLyrics.parseTTML(ttml);
			if (!parsed || !parsed.lines || parsed.lines.length === 0)
			{
				self._onLyricsUnavailable(songId);
				return;
			}
			self._lyricsState = "loaded";
			self._lyrics = parsed;
			self.renderLyrics();
			if (self._lastLyricsPos !== undefined)
			{
				self.updateLyricsTime(self._lastLyricsPos);
			}
		}).catch(function ()
		{
			if (self._lyricsSongId !== songId) { return; }
			if (typeof songId === "string" && songId.indexOf("i.") === 0)
			{
				self.$.AppleMusicService.request("/me/library/songs/" + encodeURIComponent(songId), { include: "catalog" })
					.then(function (cRes)
					{
						if (self._lyricsSongId !== songId) { return; }
						var catSong = cRes && cRes.data && cRes.data[0] &&
							cRes.data[0].relationships && cRes.data[0].relationships.catalog &&
							cRes.data[0].relationships.catalog.data && cRes.data[0].relationships.catalog.data[0];
						if (catSong && catSong.id)
						{
							if (self._trackInfo) { self._trackInfo.catalogId = catSong.id; }
							self.loadLyrics(catSong.id);
						}
						else
						{
							self._onLyricsUnavailable(songId);
						}
					})
					.catch(function ()
					{
						self._onLyricsUnavailable(songId);
					});
				return;
			}
			self._onLyricsUnavailable(songId);
		});
	},

	_onLyricsUnavailable: function (songId)
	{
		if (songId && this._lyricsSongId !== songId) { return; }
		this._lyricsState = "unavailable";
		this._lyrics = null;
		this._activeLyricIdx = -1;
		this._renderLyricsUnavailable();
	},

	_renderLyricsUnavailable: function ()
	{
		this._renderLyricsEmpty($L("No Lyrics Available"), $L("Lyrics aren't available for this song."));
	},

	_renderLyricsEmpty: function (title, subMsg)
	{
		if (!this.$.exhLyricsList) { return; }
		var html = '<div class="exh-lyrics-empty">';
		if (title)
		{
			html += '<div class="exh-lyrics-empty-title">' + JukieLyrics.escapeHTML(title) + '</div>';
		}
		if (subMsg)
		{
			html += '<div class="exh-lyrics-empty-sub">' + JukieLyrics.escapeHTML(subMsg) + '</div>';
		}
		html += '</div>';
		this.$.exhLyricsList.setContent(html);
	},

	renderLyrics: function ()
	{
		if (!this.$.exhLyricsList) { return; }
		if (!this._lyrics || !this._lyrics.lines || this._lyrics.lines.length === 0)
		{
			this._renderLyricsUnavailable();
			return;
		}
		var lines = this._lyrics.lines;
		var html = [];
		for (var i = 0; i < lines.length; i++)
		{
			var line = lines[i];
			var beginAttr = (line.begin !== null && line.begin !== undefined) ? (' data-begin="' + line.begin + '"') : '';
			var endAttr = (line.end !== null && line.end !== undefined) ? (' data-end="' + line.end + '"') : '';
			var activeClass = (i === this._activeLyricIdx) ? " is-active" : "";
			var text = line.text ? JukieLyrics.escapeHTML(line.text) : '&nbsp;';
			html.push('<div class="exh-lyrics-line' + activeClass + '" id="enyo-exh-lyric-line-' + i + '" data-idx="' + i + '"' + beginAttr + endAttr + '>' + text + '</div>');
		}
		if (this._lyrics.songwriters && this._lyrics.songwriters.length > 0)
		{
			var sw = JukieLyrics.escapeHTML(this._lyrics.songwriters.join(", "));
			html.push('<div class="exh-lyrics-songwriters">' + $L("Written by: ") + sw + '</div>');
		}
		this.$.exhLyricsList.setContent(html.join(""));
	},

	updateLyricsTime: function (currentTime)
	{
		this._lastLyricsPos = currentTime;
		if (!this._lyrics || !this._lyrics.lines || !this.$.exhLyricsPanel || !this.$.exhLyricsPanel.getShowing())
		{
			return;
		}

		var lines = this._lyrics.lines;
		var activeIdx = JukieLyrics.findActiveLineIndex(lines, currentTime);
		if (activeIdx === this._activeLyricIdx)
		{
			return;
		}

		if (this._activeLyricIdx >= 0)
		{
			var oldElem = document.getElementById("enyo-exh-lyric-line-" + this._activeLyricIdx);
			if (oldElem)
			{
				oldElem.className = oldElem.className.replace(/\bis-active\b/g, "").trim();
			}
		}

		this._activeLyricIdx = activeIdx;

		if (activeIdx >= 0)
		{
			var newElem = document.getElementById("enyo-exh-lyric-line-" + activeIdx);
			if (newElem)
			{
				if (newElem.className.indexOf("is-active") === -1)
				{
					newElem.className = (newElem.className + " is-active").trim();
				}
				this.scrollActiveLyricIntoView(newElem);
			}
		}
	},

	scrollActiveLyricIntoView: function (lineNode)
	{
		if (!lineNode || !this.$.exhLyricsScroller) { return; }
		var scroller = this.$.exhLyricsScroller;
		var scrollerNode = scroller.hasNode();
		if (!scrollerNode) { return; }

		if (scroller.isScrolling && scroller.isScrolling())
		{
			return;
		}

		var containerHeight = scrollerNode.clientHeight || 400;
		var targetY = lineNode.offsetTop - (containerHeight / 2) + (lineNode.clientHeight / 2);
		if (targetY < 0) { targetY = 0; }

		if (scroller.scrollTo)
		{
			scroller.scrollTo(targetY, 0);
		}
		else if (scroller.setScrollTop)
		{
			scroller.setScrollTop(targetY);
		}
		else
		{
			scrollerNode.scrollTop = targetY;
		}
	},

	onclick_lyricsList: function (sender, event)
	{
		var target = (event && (event.target || event.srcElement)) || (window.event && window.event.target);
		while (target && this.$.exhLyricsList && target !== this.$.exhLyricsList.hasNode())
		{
			if (target.getAttribute && target.getAttribute("data-begin") !== null)
			{
				var sec = parseFloat(target.getAttribute("data-begin"));
				if (!isNaN(sec) && sec >= 0)
				{
					if (this._standalone)
					{
						if (this.$.Playback && this.$.Playback.seekTo)
						{
							this.$.Playback.seekTo(sec);
						}
					}
					else
					{
						this.sendCommand("seek", { seekPosition: sec });
					}
					var idxStr = target.getAttribute("data-idx");
					if (idxStr !== null && idxStr !== undefined)
					{
						var idx = parseInt(idxStr, 10);
						if (!isNaN(idx))
						{
							if (this._activeLyricIdx >= 0)
							{
								var oldElem = document.getElementById("enyo-exh-lyric-line-" + this._activeLyricIdx);
								if (oldElem) { oldElem.className = oldElem.className.replace(/\bis-active\b/g, "").trim(); }
							}
							this._activeLyricIdx = idx;
							var newElem = document.getElementById("enyo-exh-lyric-line-" + idx);
							if (newElem && newElem.className.indexOf("is-active") === -1)
							{
								newElem.className = (newElem.className + " is-active").trim();
								this.scrollActiveLyricIntoView(newElem);
							}
						}
					}
				}
				break;
			}
			target = target.parentNode;
		}
	}
});
