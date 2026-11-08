/*globals Mojo, Jukie, JukieLyrics, JukieEmoji, setInterval, clearInterval, setTimeout, clearTimeout, Date */
/*
 * ExhibitionAssistant - ambient full-screen now-playing display (Touchstone dock mode).
 * Passive display only: reads Jukie.currentTrack / Jukie.playback directly, the exact
 * same singleton NowplayingAssistant uses - no separate playback engine. Lives on its own
 * dedicated "dock"-named, "dockMode"-typed stage (see Jukie.enterExhibition in
 * app-assistant.js), not a scene pushed onto the regular card stack - that stage TYPE is
 * what gets the real chrome-free system presentation. See app-assistant.js's handleLaunch
 * for the real dock-launch path, and mainmenu-assistant.js's "Exhibition Mode" app-menu
 * item for manual entry without a physical dock (goes through the same Jukie.enterExhibition
 * helper, so it exercises the identical stage-creation code).
 *
 * Supports synchronized lyrics when toggled. On the Pre (320x480), the lyrics overlay
 * is positioned strictly between the top clock and the bottom times/transport controls,
 * with zero overlap over either.
 */
var ExhibitionAssistant = function () {
	this._clockTimer = null;
	this._lyrics = null;
	this._lyricsSongId = null;
	this._lyricsState = "idle";
	this._showingLyrics = false;
	this._activeLyricIdx = -1;
	this._lastPos = 0;
	this._userInteractingLyrics = false;
	this._userScrollTimeout = null;
};

// Paint whatever's playing. Exhibition runs on its own dedicated stage (see
// Jukie.enterExhibition in app-assistant.js), so Jukie.currentTrack - a plain in-memory
// value set by whichever OTHER stage's context last called Jukie.playAt() - is normally
// unset here; fall back to the db8-persisted ref (Jukie.loadNowPlaying) that actually
// crosses stages. Checking currentTrack first costs nothing and still short-circuits
// correctly on the rare chance this scene ever does share context with the setter.
ExhibitionAssistant.prototype.renderTrack = function () {
	if (Jukie.currentTrack) {
		this._paintTrack(Jukie.currentTrack);
		return;
	}
	var self = this;
	Jukie.loadNowPlaying().then(function (rec) { self._paintTrack(rec); });
};

ExhibitionAssistant.prototype._paintTrack = function (track) {
	track = track || {};
	// Stashed so onPlayPause can start/resume playback from Exhibition even when
	// Jukie.currentTrack (this scene's OWN stage's copy) is empty - the common case,
	// since the track is normally started from the main app's stage instead.
	this._track = track;
	this.controller.get("exh-title").update(JukieEmoji.text(track.title || "Unknown").escapeHTML());
	this.controller.get("exh-artist").update(JukieEmoji.text(track.artist || "").escapeHTML());
	this.controller.get("exh-album").update(JukieEmoji.text(track.album || "").escapeHTML());
	// Larger than Now Playing's art fetch (300) since this is a full-bleed background,
	// not a bounded thumbnail. Jukie.artUrl also forces http - see its own note.
	var art = Jukie.artUrl(track.artUrl, 640);
	this.controller.get("exh-art").style.backgroundImage = art ? ("url('" + art + "')") : "";

	this.updateLyricsMeta();
	this.loadLyrics(track);
	this._applyLyricsVisibility();
};

ExhibitionAssistant.prototype.setup = function () {
	try {
		this._setupInner();
	} catch (e) {
		Mojo.Log.error("[Exhibition] setup() threw: " + e + (e && e.stack ? ("\n" + e.stack) : ""));
	}
};

ExhibitionAssistant.prototype.layout = function () {
	var scene = this.controller.get("exh-scene");
	var win = this.controller.window || window;
	var winW = win.innerWidth || 320;
	var winH = win.innerHeight || 480;

	if (scene) {
		scene.style.width = winW + "px";
		scene.style.height = winH + "px";
	}

	var overlay = this.controller.get("exh-lyrics-overlay");
	var scroller = this.controller.get("exh-lyrics-scroller");
	if (overlay && scroller) {
		// Pinned strictly between clock (Y~60) and times/transport (Y~356).
		// Height is at least 240px, fitting comfortably on 320x480.
		var overlayH = Math.max(240, winH - 60 - 124);
		overlay.style.height = overlayH + "px";
		scroller.style.height = (overlayH - 32) + "px";
		if (scroller.mojo && typeof scroller.mojo.validateScrollPosition === "function") {
			scroller.mojo.validateScrollPosition();
		}
	}
};

ExhibitionAssistant.prototype._setupInner = function () {
	Mojo.Log.info("[Exhibition] setup() entered");

	var scene = this.controller.get("exh-scene");
	if (scene && this.controller.window) {
		scene.style.width = this.controller.window.innerWidth + "px";
		scene.style.height = this.controller.window.innerHeight + "px";
	}

	// Restore lyrics toggled state from localStorage
	var savedToggled = false;
	try { savedToggled = (localStorage.getItem("jukie_lyrics_toggled") === "1"); } catch (e) {}
	this._showingLyrics = savedToggled;

	// Setup Mojo Scroller for exhibition lyrics
	this.controller.setupWidget("exh-lyrics-scroller", { mode: "vertical" }, {});

	// Touch interaction detection on scroller to temporarily pause auto-scroll
	var scroller = this.controller.get("exh-lyrics-scroller");
	var self = this;
	this._onUserScrollStart = function () {
		self._userInteractingLyrics = true;
		if (self._userScrollTimeout) {
			clearTimeout(self._userScrollTimeout);
		}
		self._userScrollTimeout = setTimeout(function () {
			self._userInteractingLyrics = false;
			self.scrollActiveLyricIntoView();
		}, 4500);
	};
	this._onUserScrollEnd = function () {
		if (self._userScrollTimeout) {
			clearTimeout(self._userScrollTimeout);
		}
		self._userScrollTimeout = setTimeout(function () {
			self._userInteractingLyrics = false;
			self.scrollActiveLyricIntoView();
		}, 3000);
	};
	if (scroller) {
		this.scrollerDragStartHandler = this._onUserScrollStart.bind(this);
		this.scrollerFlickHandler = this._onUserScrollStart.bind(this);
		this.scrollerDragEndHandler = this._onUserScrollEnd.bind(this);
		scroller.observe(Mojo.Event.dragStart, this.scrollerDragStartHandler);
		scroller.observe(Mojo.Event.flick, this.scrollerFlickHandler);
		scroller.observe(Mojo.Event.dragEnd, this.scrollerDragEndHandler);
	}

	this.layout();
	this.renderTrack();

	this.spinnerModel = { spinning: false };
	this.controller.setupWidget("exh-spinner", { spinnerSize: "small" }, this.spinnerModel);

	// Transport: prev / play-pause / next
	this.ppHandler = this.onPlayPause.bindAsEventListener(this);
	this.controller.get("exh-playpause").observe(Mojo.Event.tap, this.ppHandler);
	this.prevHandler = this.onPrev.bindAsEventListener(this);
	this.controller.get("exh-prev").observe(Mojo.Event.tap, this.prevHandler);
	this.nextHandler = this.onNext.bindAsEventListener(this);
	this.controller.get("exh-next").observe(Mojo.Event.tap, this.nextHandler);

	// Tap background to exit Exhibition
	this.bgHandler = this.onBackgroundTap.bindAsEventListener(this);
	this.controller.get("exh-art").observe(Mojo.Event.tap, this.bgHandler);

	// Tap lyric line to seek
	this.lyricsTapHandler = this.onLyricLineTap.bindAsEventListener(this);
	var lyricsList = this.controller.get("exh-lyrics-list");
	if (lyricsList) { lyricsList.observe(Mojo.Event.tap, this.lyricsTapHandler); }

	// Attach to playback service callbacks
	this._pb = Jukie.playback;
	this._pb.onTimeUpdate = function (p) { self.onTimeUpdate(p); };
	this._pb.onPlaying = function () { self.setPlayingUI(true); self.setBuffering(false); };
	this._pb.onPaused = function () { self.setPlayingUI(false); self.setBuffering(false); };
	this._pb.onBuffering = function (p) { self.setBuffering(p.buffering); };
	this._pb.onEnded = function () { self.setPlayingUI(false); self.setBuffering(false); self.updateTimes(0, self._duration || 0); };
	this._pb.onError = function () { self.setPlayingUI(false); self.setBuffering(false); };
	this._pb.onTrackChanged = function () { self.renderTrack(); };

	this.setPlayingUI(this._pb.isPlaying());
	this.setBuffering(this._pb.isBuffering());
	this._pb.refreshStatus();

	// Clock: h:mm AM/PM, ticking every second
	this._tickClock();
	this._clockTimer = setInterval(this._tickClock.bind(this), 1000);

	Mojo.Log.info("[Exhibition] setup() completed");
};

ExhibitionAssistant.prototype._applyLyricsVisibility = function () {
	var overlay = this.controller.get("exh-lyrics-overlay");
	var trackInfo = this.controller.get("exh-track-info");
	var scene = this.controller.get("exh-scene");

	if (this._showingLyrics) {
		if (overlay) { overlay.style.display = "-webkit-box"; }
		if (trackInfo) { trackInfo.style.display = "none"; }
		if (scene) { scene.addClassName("has-lyrics"); }
		this.layout();
		if (this._lastPos !== undefined && this._lyrics && this._lyrics.lines) {
			this._activeLyricIdx = -1;
			this.updateLyricsTime(this._lastPos);
		} else if (this._activeLyricIdx >= 0) {
			this._setLineActive(this._activeLyricIdx, true);
			this.scrollActiveLyricIntoView();
		}
	} else {
		if (overlay) { overlay.style.display = "none"; }
		if (trackInfo) { trackInfo.style.display = "block"; }
		if (scene) { scene.removeClassName("has-lyrics"); }
	}
};

ExhibitionAssistant.prototype.onToggleLyrics = function () {
	this._showingLyrics = !this._showingLyrics;
	try { localStorage.setItem("jukie_lyrics_toggled", this._showingLyrics ? "1" : "0"); } catch (e) {}
	this._userInteractingLyrics = false;
	if (this._userScrollTimeout) {
		clearTimeout(this._userScrollTimeout);
		this._userScrollTimeout = null;
	}
	this._applyLyricsVisibility();
};

ExhibitionAssistant.prototype.updateLyricsMeta = function () {
	var el = this.controller.get("exh-lyrics-track");
	if (!el) { return; }
	var track = this._track || Jukie.currentTrack || {};
	var title = track.title || "Unknown";
	var artist = track.artist || "";
	var meta = JukieEmoji.text(title).escapeHTML();
	if (artist) {
		meta += ' &middot; <span class="jukie-exh-lyrics-meta-artist">' + JukieEmoji.text(artist).escapeHTML() + '</span>';
	}
	el.innerHTML = meta;
};

ExhibitionAssistant.prototype._getTrackSongId = function (track) {
	if (!track) { return null; }
	if (typeof track === "string" || typeof track === "number") {
		return "" + track;
	}
	var id = track.catalogId || track.id || track.libraryId || track.strTrackID;
	return id ? ("" + id) : null;
};

ExhibitionAssistant.prototype.loadLyrics = function (track) {
	var self = this;
	var t = (track && typeof track === "object") ? track : (this._track || Jukie.currentTrack || {});
	var songId = this._getTrackSongId(t);

	if (!songId) {
		this._lyricsState = "unavailable";
		this._lyrics = null;
		this._lyricsSongId = null;
		this._activeLyricIdx = -1;
		this._renderLyricsList();
		return;
	}

	if (this._lyricsSongId === songId) {
		if (this._lyricsState === "loaded" && this._lyrics) {
			this._renderLyricsList();
			if (this._lastPos !== undefined) {
				this.updateLyricsTime(this._lastPos);
			}
			return;
		}
		if (this._lyricsState === "unavailable") {
			this._renderLyricsList();
			return;
		}
		if (this._lyricsState === "loading") {
			return;
		}
	}

	this._lyricsSongId = songId;
	this._lyricsState = "loading";
	this._lyrics = null;
	this._activeLyricIdx = -1;
	this._renderLyricsList();

	if (!Jukie.apple) {
		this._lyricsState = "unavailable";
		this._renderLyricsList();
		return;
	}

	Jukie.apple.getLyrics(songId, { syllable: false }).then(function (response) {
		if (self._lyricsSongId !== songId) { return; }
		var ttml = JukieLyrics.extractTTML(response);
		if (!ttml) {
			self._onLyricsUnavailable(songId);
			return;
		}
		var parsed = JukieLyrics.parseTTML(ttml);
		if (!parsed || !parsed.lines || parsed.lines.length === 0) {
			self._onLyricsUnavailable(songId);
			return;
		}
		self._lyricsState = "loaded";
		self._lyrics = parsed;
		self._renderLyricsList();
		if (self._lastPos !== undefined) {
			self.updateLyricsTime(self._lastPos);
		}
	}).catch(function () {
		if (self._lyricsSongId !== songId) { return; }
		// If songId was a library ID ('i.xxxx'), try looking up catalogId first
		if (typeof songId === "string" && songId.indexOf("i.") === 0) {
			Jukie.apple.request("/me/library/songs/" + encodeURIComponent(songId), { include: "catalog" })
				.then(function (cRes) {
					if (self._lyricsSongId !== songId) { return; }
					var catSong = cRes && cRes.data && cRes.data[0] &&
						cRes.data[0].relationships && cRes.data[0].relationships.catalog &&
						cRes.data[0].relationships.catalog.data && cRes.data[0].relationships.catalog.data[0];
					if (catSong && catSong.id) {
						if (self._track) { self._track.catalogId = catSong.id; }
						self.loadLyrics(catSong.id);
					} else {
						self._onLyricsUnavailable(songId);
					}
				})
				.catch(function () {
					self._onLyricsUnavailable(songId);
				});
			return;
		}
		self._onLyricsUnavailable(songId);
	});
};

ExhibitionAssistant.prototype._onLyricsUnavailable = function (songId) {
	if (songId && this._lyricsSongId !== songId) { return; }
	this._lyricsState = "unavailable";
	this._lyrics = null;
	this._activeLyricIdx = -1;
	this._renderLyricsList();
};

ExhibitionAssistant.prototype._renderLyricsList = function () {
	var list = this.controller.get("exh-lyrics-list");
	if (!list) { return; }
	if (!this._lyrics || !this._lyrics.lines || this._lyrics.lines.length === 0) {
		if (this._lyricsState === "loading") {
			list.innerHTML = '<div class="jukie-exh-lyrics-empty">' +
				'<div class="jukie-exh-lyrics-empty-title">Loading lyrics…</div>' +
				'</div>';
		} else {
			list.innerHTML = '<div class="jukie-exh-lyrics-empty">' +
				'<div class="jukie-exh-lyrics-empty-title">No Lyrics Available</div>' +
				'<div class="jukie-exh-lyrics-empty-sub">Lyrics aren\'t available for this song.</div>' +
				'</div>';
		}
		return;
	}
	var html = "";
	var lines = this._lyrics.lines;
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var beginAttr = (line.begin !== null && line.begin !== undefined) ? (' data-begin="' + line.begin + '"') : '';
		var activeClass = (i === this._activeLyricIdx) ? " is-active" : "";
		html += '<div class="jukie-exh-lyrics-line' + activeClass + '" id="exh-lyric-line-' + i + '" data-idx="' + i + '"' + beginAttr + ' x-mojo-tap-highlight="momentary">' +
			JukieEmoji.text(line.text).escapeHTML() +
			'</div>';
	}
	if (this._lyrics.songwriters && this._lyrics.songwriters.length > 0) {
		var sw = this._lyrics.songwriters.join(", ");
		html += '<div class="jukie-exh-lyrics-songwriters">' +
			'Written by: ' + JukieEmoji.text(sw).escapeHTML() +
			'</div>';
	}
	list.innerHTML = html;
	var scroller = this.controller.get("exh-lyrics-scroller");
	if (scroller && scroller.mojo && typeof scroller.mojo.validateScrollPosition === "function") {
		scroller.mojo.validateScrollPosition();
	}

	if (this._activeLyricIdx >= 0) {
		this.scrollActiveLyricIntoView();
	}
};

ExhibitionAssistant.prototype._setLineActive = function (idx, active) {
	if (idx < 0) { return; }
	var el = this.controller.get("exh-lyric-line-" + idx) || document.getElementById("exh-lyric-line-" + idx);
	if (!el) {
		var list = this.controller.get("exh-lyrics-list");
		if (list && list.children && list.children[idx]) {
			el = list.children[idx];
		}
	}
	if (!el) { return; }
	var currentClass = el.className || "";
	if (active) {
		if (currentClass.indexOf("is-active") === -1) {
			el.className = (currentClass + " is-active").trim();
		}
	} else {
		if (currentClass.indexOf("is-active") !== -1) {
			el.className = currentClass.replace(/\bis-active\b/g, "").replace(/\s+/g, " ").trim();
		}
	}
};

ExhibitionAssistant.prototype.scrollActiveLyricIntoView = function () {
	if (!this._showingLyrics || this._activeLyricIdx < 0 || this._userInteractingLyrics) { return; }
	var list = this.controller.get("exh-lyrics-list");
	var scroller = this.controller.get("exh-lyrics-scroller");
	if (!list || !scroller) { return; }
	var activeEl = this.controller.get("exh-lyric-line-" + this._activeLyricIdx) ||
		document.getElementById("exh-lyric-line-" + this._activeLyricIdx);
	if (!activeEl && list.children) {
		activeEl = list.children[this._activeLyricIdx];
	}
	if (activeEl) {
		var elTop = activeEl.offsetTop;
		var elHeight = activeEl.offsetHeight;
		var scrollerHeight = scroller.offsetHeight || 260;
		var targetY = Math.max(0, Math.round(elTop - (scrollerHeight / 2) + (elHeight / 2)));
		if (scroller.mojo && typeof scroller.mojo.scrollTo === "function") {
			// webOS 2 Mojo Scroller expects positive y coordinate for downward scrolling
			scroller.mojo.scrollTo(0, targetY, true);
		}
	}
};

ExhibitionAssistant.prototype.updateLyricsTime = function (pos) {
	this._lastPos = pos;
	if (!this._lyrics || !this._lyrics.lines || !this._lyrics.lines.length) {
		return;
	}
	var idx = JukieLyrics.findActiveLineIndex(this._lyrics.lines, pos);
	if (idx === this._activeLyricIdx) {
		return;
	}

	if (this._activeLyricIdx >= 0) {
		this._setLineActive(this._activeLyricIdx, false);
	}

	this._activeLyricIdx = idx;

	if (idx >= 0) {
		this._setLineActive(idx, true);
		this.scrollActiveLyricIntoView();
	}
};

ExhibitionAssistant.prototype.onLyricLineTap = function (event) {
	var target = event.target;
	var list = this.controller.get("exh-lyrics-list");
	while (target && target !== list) {
		if (target.className && target.className.indexOf("jukie-exh-lyrics-line") !== -1) {
			break;
		}
		target = target.parentNode;
	}
	if (!target || !target.className || target.className.indexOf("jukie-exh-lyrics-line") === -1) { return; }
	var secStr = target.getAttribute("data-begin");
	if (secStr !== null && secStr !== undefined && secStr !== "") {
		var sec = parseFloat(secStr);
		if (!isNaN(sec) && sec >= 0 && this._pb && this._duration > 0) {
			this._pb.seekTo(Math.round(sec));
			var idxStr = target.getAttribute("data-idx");
			if (idxStr !== null && idxStr !== undefined) {
				var idx = parseInt(idxStr, 10);
				if (!isNaN(idx)) {
					if (this._activeLyricIdx >= 0) {
						this._setLineActive(this._activeLyricIdx, false);
					}
					this._activeLyricIdx = idx;
					this._setLineActive(idx, true);
					this._userInteractingLyrics = false;
					if (this._userScrollTimeout) {
						clearTimeout(this._userScrollTimeout);
						this._userScrollTimeout = null;
					}
					this.scrollActiveLyricIntoView();
				}
			}
		}
	}
};

ExhibitionAssistant.prototype._tickClock = function () {
	var d = new Date();
	var h = d.getHours() % 12;
	if (h === 0) { h = 12; }
	var ampm = d.getHours() >= 12 ? "PM" : "AM";
	var m = d.getMinutes();
	var el = this.controller.get("exh-clock");
	if (el) { el.update(h + ":" + (m < 10 ? "0" : "") + m + " " + ampm); }
};

ExhibitionAssistant.prototype.setBuffering = function (buffering) {
	this.spinnerModel.spinning = !!buffering;
	this.controller.modelChanged(this.spinnerModel);
	var btn = this.controller.get("exh-playpause");
	if (btn) { btn.style.visibility = buffering ? "hidden" : "visible"; }
};

ExhibitionAssistant.prototype.onTimeUpdate = function (p) {
	var pos = p.currentTime || 0, dur = p.duration || 0;
	this._duration = dur;
	this.updateTimes(pos, dur);
	this.updateLyricsTime(pos);
};

ExhibitionAssistant.prototype.updateTimes = function (pos, dur) {
	var elElapsed = this.controller.get("exh-elapsed");
	if (elElapsed) { elElapsed.innerHTML = this._fmtTime(pos); }
	var elDuration = this.controller.get("exh-duration");
	if (elDuration) { elDuration.innerHTML = this._fmtTime(dur); }
};

ExhibitionAssistant.prototype._fmtTime = function (secs) {
	secs = Math.max(0, Math.floor(secs || 0));
	var m = Math.floor(secs / 60), s = secs % 60;
	return m + ":" + (s < 10 ? "0" + s : s);
};

ExhibitionAssistant.prototype.setPlayingUI = function (playing) {
	var btn = this.controller.get("exh-playpause");
	if (!btn) { return; }
	if (playing) { btn.removeClassName("is-play"); btn.addClassName("is-pause"); }
	else { btn.removeClassName("is-pause"); btn.addClassName("is-play"); }
};

ExhibitionAssistant.prototype.onPlayPause = function () {
	if (this._pb.isPlaying()) {
		this._pb.pause();
	} else if (this._pb._songId) {
		this._pb.resume();
	} else {
		// Jukie.currentTrack (this stage's OWN copy) is normally empty here - the track is
		// commonly started from the main app's stage instead - so fall back to the
		// db8-loaded ref this scene already painted itself from (see _paintTrack).
		var track = Jukie.currentTrack || this._track;
		if (track) {
			this._pb.load("", track.catalogId, track.libraryId);
			this._pb.play();
			this.setBuffering(true);
		}
	}
};

ExhibitionAssistant.prototype.onPrev = function () {
	if (Jukie.playPrev()) { this.renderTrack(); this.setBuffering(true); }
};

ExhibitionAssistant.prototype.onNext = function () {
	if (Jukie.playNext()) { this.renderTrack(); this.setBuffering(true); }
};

// Exhibition now lives on its own dedicated "dock" stage (see Jukie.enterExhibition in
// app-assistant.js), not a scene pushed onto the regular card stack, so there is no
// scene underneath to pop back to - closing this stage's own window is what returns to
// whatever was already open (the main card, untouched, since it was never swapped away).
ExhibitionAssistant.prototype.onBackgroundTap = function (event) {
	// Only exit if tapping the background art layer or scrim, not elements within content
	if (event && event.target) {
		var t = event.target;
		if (t.id === "exh-art" || t.className.indexOf("jukie-exh-art") !== -1 ||
			t.className.indexOf("jukie-exh-scrim") !== -1 || t.id === "exh-scene") {
			this.controller.window.close();
		}
	} else {
		this.controller.window.close();
	}
};

ExhibitionAssistant.prototype.cleanup = function () {
	this.controller.get("exh-playpause").stopObserving(Mojo.Event.tap, this.ppHandler);
	this.controller.get("exh-prev").stopObserving(Mojo.Event.tap, this.prevHandler);
	this.controller.get("exh-next").stopObserving(Mojo.Event.tap, this.nextHandler);
	this.controller.get("exh-art").stopObserving(Mojo.Event.tap, this.bgHandler);

	var lyricsList = this.controller.get("exh-lyrics-list");
	if (lyricsList && this.lyricsTapHandler) { lyricsList.stopObserving(Mojo.Event.tap, this.lyricsTapHandler); }

	var scroller = this.controller.get("exh-lyrics-scroller");
	if (scroller) {
		if (this.scrollerDragStartHandler) { scroller.stopObserving(Mojo.Event.dragStart, this.scrollerDragStartHandler); }
		if (this.scrollerFlickHandler) { scroller.stopObserving(Mojo.Event.flick, this.scrollerFlickHandler); }
		if (this.scrollerDragEndHandler) { scroller.stopObserving(Mojo.Event.dragEnd, this.scrollerDragEndHandler); }
	}

	if (this._userScrollTimeout) {
		clearTimeout(this._userScrollTimeout);
		this._userScrollTimeout = null;
	}

	if (this._clockTimer !== null) {
		clearInterval(this._clockTimer);
		this._clockTimer = null;
	}
	if (this._pb) {
		this._pb.onTimeUpdate = this._pb.onPlaying = this._pb.onPaused = null;
		this._pb.onBuffering = this._pb.onEnded = this._pb.onError = null;
		this._pb.onTrackChanged = null;
	}
};
