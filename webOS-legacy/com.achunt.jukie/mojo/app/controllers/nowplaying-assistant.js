/*globals Mojo, Jukie, setTimeout, clearTimeout */
/*
 * NowplayingAssistant - the player scene. Shows the current track (from Jukie.currentTrack,
 * set when a row was tapped) and reflects live playback state pushed by PlaybackService,
 * which polls the Luna service (com.achunt.jukie.service) while active. Play/pause toggles
 * the service; the slider seeks (routed through the service's ffmpeg fragment-cut seek).
 *
 * The heavy lifting - fetch, Widevine license, decrypt, gst playback - all happens in the
 * service + jukie-drm; this scene is just the transport UI over it.
 */
var NowplayingAssistant = function () {
	this._seeking = false;
	this._seekApplyTimer = null;
	this._seekClearTimer = null;
	this._artPx = 300;
	this._lyrics = null;
	this._lyricsSongId = null;
	this._lyricsState = "idle";
	this._showingLyrics = false;
	this._activeLyricIdx = -1;
	this._lastPos = 0;
	this._scrollTimer = null;
	this._userInteractingLyrics = false;
	this._userScrollTimeout = null;
};

// Fit the scene to the real screen: calculate art and lyrics heights dynamically so that
// controls are always pinned to the bottom of the card.
NowplayingAssistant.prototype.layout = function () {
	var root = this.controller.get("np-root");
	var art = this.controller.get("np-art");
	var lyricsOverlay = this.controller.get("np-lyrics-overlay");
	var lyricsScroller = this.controller.get("np-lyrics-scroller");
	var bottomControls = this.controller.get("np-bottom-controls");
	if (!root || !art) { return; }
	var w = window.innerWidth, h = window.innerHeight;

	// On 480px cards (Pre 2), size is 150px. On taller screens (>500px), art scales up.
	var tall = h > 500;
	var size = tall ? Math.max(150, Math.min(w - 64, h - 330)) : 150;
	art.style.width = art.style.height = size + "px";

	// Lyrics overlay stretches to fill available card height above transport controls,
	// pushing the controls firmly toward the bottom of the card.
	if (lyricsOverlay) {
		var controlsH = (bottomControls && bottomControls.offsetHeight > 30) ? bottomControls.offsetHeight : 96;
		var overlayH = Math.max(260, h - 52 - controlsH - 4);
		lyricsOverlay.style.height = overlayH + "px";
		if (lyricsScroller) {
			lyricsScroller.style.height = (overlayH - 30) + "px";
			if (lyricsScroller.mojo && typeof lyricsScroller.mojo.validateScrollPosition === "function") {
				lyricsScroller.mojo.validateScrollPosition();
			}
		}
	}

	var px = tall ? Math.min(640, Math.round(size * 1.5)) : 300;
	if (px !== this._artPx) {
		this._artPx = px;
		this.renderTrack();
	}
	// Only once activated: the Slider widget isn't instantiated yet during setup().
	if (this._active && this.seekModel) { this.controller.modelChanged(this.seekModel); }
};

// Paint whatever Jukie.currentTrack is now. Called on setup and again after prev/next,
// since those swap the track while this scene stays on screen.
NowplayingAssistant.prototype.renderTrack = function () {
	var self = this;
	var track = Jukie.currentTrack;
	if (!track) {
		if (Jukie.loadNowPlaying) {
			Jukie.loadNowPlaying().then(function (savedTrack) {
				if (savedTrack && !Jukie.currentTrack) {
					Jukie.currentTrack = savedTrack;
					self.renderTrack();
				}
			});
		}
		track = {};
	}
	var titleEl = this.controller.get("np-title");
	if (titleEl) { titleEl.update(JukieEmoji.text(track.title || "Unknown").escapeHTML()); }
	var artistEl = this.controller.get("np-artist");
	if (artistEl) { artistEl.update(JukieEmoji.text(track.artist || "").escapeHTML()); }
	var albumEl = this.controller.get("np-album");
	if (albumEl) { albumEl.update(JukieEmoji.text(track.album || "").escapeHTML()); }
	// Jukie.artUrl fills the {w}x{h} template AND forces http - https to Apple hosts
	// cannot handshake on this device, so an https URL here renders as an empty box.
	var art = Jukie.artUrl(track.artUrl, this._artPx);
	var artEl = this.controller.get("np-art");
	if (artEl) { artEl.style.backgroundImage = art ? ("url('" + art + "')") : ""; }
	if (this.appMenuModel) {
		this.refreshOfflineMenu();
		this.refreshLyricsMenu();
	}
	this.loadLyrics(track);
	if (this._showingLyrics) {
		this.updateLyricsMeta();
	}
};

NowplayingAssistant.prototype.setup = function () {
	Jukie.setupBack(this.controller);
	this.renderTrack();

	// Seek slider (0..1000 maps to a 0..1 fraction of duration).
	this.seekModel = { value: 0 };
	this.controller.setupWidget("seekSlider", { modelProperty: "value", minValue: 0, maxValue: 1000 }, this.seekModel);
	this.seekHandler = this.onSeekChange.bindAsEventListener(this);
	this.controller.get("seekSlider").observe(Mojo.Event.propertyChange, this.seekHandler);

	this.layoutHandler = this.layout.bind(this);
	window.addEventListener("resize", this.layoutHandler, false);
	this.layout();

	// Stock webOS spinner, shown over the play/pause button while a track is loading
	// (fetch + decrypt, before gst actually starts) instead of leaving stale "Buffering…"
	// text up once playback is actually under way.
	this.spinnerModel = { spinning: false };
	this.controller.setupWidget("np-spinner", { spinnerSize: "small" }, this.spinnerModel);

	// Transport: prev / play-pause / next.
	this.ppHandler = this.onPlayPause.bindAsEventListener(this);
	this.controller.get("np-playpause").observe(Mojo.Event.tap, this.ppHandler);
	this.prevHandler = this.onPrev.bindAsEventListener(this);
	this.controller.get("np-prev").observe(Mojo.Event.tap, this.prevHandler);
	this.nextHandler = this.onNext.bindAsEventListener(this);
	this.controller.get("np-next").observe(Mojo.Event.tap, this.nextHandler);

	// Tapping album art or lyrics header also toggles between art and lyrics
	this.artTapHandler = this.onToggleLyrics.bindAsEventListener(this);
	this.controller.get("np-art").observe(Mojo.Event.tap, this.artTapHandler);
	this.lyricsHeaderTapHandler = this.onToggleLyrics.bindAsEventListener(this);
	this.controller.get("np-lyrics-header").observe(Mojo.Event.tap, this.lyricsHeaderTapHandler);
	this.lyricsTapHandler = this.onLyricLineTap.bindAsEventListener(this);
	this.controller.get("np-lyrics-list").observe(Mojo.Event.tap, this.lyricsTapHandler);

	// Setup the native Mojo Scroller for lyrics
	this.controller.setupWidget("np-lyrics-scroller", { mode: "vertical" }, {});

	// User touch interaction on scroller to pause auto-scroll temporarily
	var scroller = this.controller.get("np-lyrics-scroller");
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

	// Attach to the playback service's live callbacks for the lifetime of this scene.
	this._pb = Jukie.playback;
	this._pb.onTimeUpdate = function (p) { self.onTimeUpdate(p); };
	this._pb.onPlaying = function () { self.setPlayingUI(true); self.setBuffering(false); self.setState(""); };
	this._pb.onPaused = function () { self.setPlayingUI(false); self.setBuffering(false); self.setState(""); };
	this._pb.onBuffering = function (p) { self.setBuffering(p.buffering); };
	this._pb.onEnded = function () { self.setPlayingUI(false); self.setBuffering(false); self.setState("Finished"); self.updateTimes(0, self._duration || 0); };
	this._pb.onError = function (p) {
		self.setPlayingUI(false); self.setBuffering(false);
		var offlineMiss = p && typeof p.error === "string" && p.error.indexOf("not available offline") === 0;
		self.setState(offlineMiss ? "Not available offline" : "Playback error");
	};
	this._pb.onTrackChanged = function () { self.renderTrack(); };

	// App menu: dynamic Show/Hide lyrics + save current track for offline play.
	this.appMenuModel = {
		visible: true,
		items: [
			{ label: "Show Lyrics", command: "do-toggle-lyrics" },
			{ label: "Save for offline", command: "do-offline" }
		]
	};
	this.controller.setupWidget(Mojo.Menu.appMenu, { omitDefaultItems: true }, this.appMenuModel);
	this.offlineWatcher = this.refreshOfflineMenu.bind(this);
	Jukie.watchOffline(this.offlineWatcher);
	this.refreshOfflineMenu();
	this.refreshLyricsMenu();

	// Restore lyrics toggled state from localStorage
	var savedLyricsToggled = false;
	try { savedLyricsToggled = (localStorage.getItem("jukie_lyrics_toggled") === "1"); } catch (e) {}
	if (savedLyricsToggled) {
		this.onToggleLyrics();
	}

	// Initial UI from whatever the service already reports.
	this.setPlayingUI(this._pb.isPlaying());
	this.setBuffering(this._pb.isBuffering());
	this.setState("");
};

NowplayingAssistant.prototype.refreshLyricsMenu = function () {
	if (!this.appMenuModel || !this.appMenuModel.items) { return; }
	var item = this.appMenuModel.items[0];
	if (!item || item.command !== "do-toggle-lyrics") { return; }
	item.label = this._showingLyrics ? "Hide Lyrics" : "Show Lyrics";
	var track = Jukie.currentTrack || {};
	item.disabled = !(track && (track.title || track.catalogId));
	try { this.controller.modelChanged(this.appMenuModel); } catch (e) { /* menu not instantiated yet */ }
};

NowplayingAssistant.prototype.refreshOfflineMenu = function () {
	if (!this.appMenuModel || !this.appMenuModel.items) { return; }
	var item = this.appMenuModel.items[1];
	if (!item || item.command !== "do-offline") { return; }
	var track = Jukie.currentTrack || {};
	var saved = !!(track.catalogId && Jukie.savedIds[track.catalogId]);
	item.label = saved ? "Remove from offline" : "Save for offline";
	item.disabled = !track.catalogId;
	try { this.controller.modelChanged(this.appMenuModel); } catch (e) { /* menu not instantiated yet */ }
};

NowplayingAssistant.prototype.handleCommand = function (event) {
	if (event.type !== Mojo.Event.command) { return; }
	if (event.command === "do-toggle-lyrics") {
		this.onToggleLyrics();
	} else if (event.command === "do-offline") {
		var track = Jukie.currentTrack;
		if (!track || !track.catalogId) { return; }
		if (Jukie.savedIds[track.catalogId]) {
			Jukie.removeOffline(track);
		} else if (!Jukie.online && !Jukie.offlineIds[track.catalogId]) {
			this.controller.showAlertDialog({
				title: "You're offline", message: "Connect to the internet to save this song for offline play.",
				choices: [{ label: "OK", value: "ok" }]
			});
		} else {
			Jukie.saveOffline(track);
		}
	}
};

// Toggle the stock spinner over the play/pause button. The icon itself just becomes
// invisible (not removed) while spinning, so the button's footprint - and its tap
// target - never moves.
NowplayingAssistant.prototype.setBuffering = function (buffering) {
	this.spinnerModel.spinning = !!buffering;
	this.controller.modelChanged(this.spinnerModel);
	var btn = this.controller.get("np-playpause");
	if (btn) { btn.style.visibility = buffering ? "hidden" : "visible"; }
};

NowplayingAssistant.prototype.onTimeUpdate = function (p) {
	var pos = p.currentTime || 0, dur = p.duration || 0;
	this._duration = dur;
	this.updateTimes(pos, dur);
	if (!this._seeking && dur > 0) {
		this.seekModel.value = Math.max(0, Math.min(1000, Math.round((pos / dur) * 1000)));
		this.controller.modelChanged(this.seekModel);
	}
	this.updateLyricsTime(pos);
};

NowplayingAssistant.prototype.updateTimes = function (pos, dur) {
	var elElapsed = this.controller.get("np-elapsed");
	if (elElapsed) { elElapsed.innerHTML = this._fmtTime(pos); }
	var elDuration = this.controller.get("np-duration");
	if (elDuration) { elDuration.innerHTML = this._fmtTime(dur); }
};

NowplayingAssistant.prototype._fmtTime = function (secs) {
	secs = Math.max(0, Math.floor(secs || 0));
	var m = Math.floor(secs / 60), s = secs % 60;
	return m + ":" + (s < 10 ? "0" + s : s);
};

NowplayingAssistant.prototype.setPlayingUI = function (playing) {
	var btn = this.controller.get("np-playpause");
	if (!btn) { return; }
	if (playing) { btn.removeClassName("is-play"); btn.addClassName("is-pause"); }
	else { btn.removeClassName("is-pause"); btn.addClassName("is-play"); }
};

NowplayingAssistant.prototype.setState = function (text) {
	var el = this.controller.get("np-state");
	if (el) {
		el.innerHTML = text || "";
		el.style.display = text ? "block" : "none";
	}
};

NowplayingAssistant.prototype.onPlayPause = function () {
	if (this._pb.isPlaying()) {
		this._pb.pause();
	} else if (this._pb._songId) {
		this._pb.resume();
	} else if (Jukie.currentTrack) {
		this._pb.load("", Jukie.currentTrack.catalogId, Jukie.currentTrack.libraryId);
		this._pb.play();
		this.setBuffering(true); // optimistic - see the note on onPrev/onNext
	}
};

// Prev/next walk the queue seeded by whichever list was tapped. Nothing happens at the
// ends of the queue (no wrap-around), and unplayable entries are skipped by Jukie.playAt.
// setBuffering(true) here is optimistic - the poll's own onBuffering will confirm it a
// moment later - so the spinner appears immediately on tap instead of waiting a poll tick.
NowplayingAssistant.prototype.onPrev = function () {
	if (Jukie.playPrev()) { this.renderTrack(); this.setBuffering(true); }
};

NowplayingAssistant.prototype.onNext = function () {
	if (Jukie.playNext()) { this.renderTrack(); this.setBuffering(true); }
};

// Slider drag: suppress poll write-back while the user is dragging, and debounce the
// (expensive, ffmpeg-backed) seek to the trailing edge of the gesture.
NowplayingAssistant.prototype.onSeekChange = function (event) {
	var self = this;
	this._seeking = true;
	var frac = (event.value || 0) / 1000;
	if (this._seekClearTimer) { clearTimeout(this._seekClearTimer); }
	if (this._seekApplyTimer) { clearTimeout(this._seekApplyTimer); }
	this._seekApplyTimer = setTimeout(function () {
		self._seekApplyTimer = null;
		if (self._duration > 0) { self._pb.seekTo(Math.round(frac * self._duration)); }
	}, 250);
	// Consider the gesture over ~600ms after the last change, then let polling drive again.
	this._seekClearTimer = setTimeout(function () { self._seeking = false; }, 600);
};

// The scene may have been measured at zero width during setup(); re-measure once it is
// actually on screen so the knob lands on the right spot.
NowplayingAssistant.prototype.activate = function () {
	this._active = true;
	this.layout();
	var scroller = this.controller.get("np-lyrics-scroller");
	if (scroller && scroller.mojo && typeof scroller.mojo.validateScrollPosition === "function") {
		scroller.mojo.validateScrollPosition();
	}
};

NowplayingAssistant.prototype.cleanup = function () {
	this._active = false;
	Jukie.unwatchOffline(this.offlineWatcher);
	window.removeEventListener("resize", this.layoutHandler, false);
	this.controller.get("seekSlider").stopObserving(Mojo.Event.propertyChange, this.seekHandler);
	this.controller.get("np-playpause").stopObserving(Mojo.Event.tap, this.ppHandler);
	this.controller.get("np-prev").stopObserving(Mojo.Event.tap, this.prevHandler);
	this.controller.get("np-next").stopObserving(Mojo.Event.tap, this.nextHandler);
	this.controller.get("np-art").stopObserving(Mojo.Event.tap, this.artTapHandler);
	this.controller.get("np-lyrics-header").stopObserving(Mojo.Event.tap, this.lyricsHeaderTapHandler);
	this.controller.get("np-lyrics-list").stopObserving(Mojo.Event.tap, this.lyricsTapHandler);
	var scroller = this.controller.get("np-lyrics-scroller");
	if (scroller) {
		if (this.scrollerDragStartHandler) { scroller.stopObserving(Mojo.Event.dragStart, this.scrollerDragStartHandler); }
		if (this.scrollerFlickHandler) { scroller.stopObserving(Mojo.Event.flick, this.scrollerFlickHandler); }
		if (this.scrollerDragEndHandler) { scroller.stopObserving(Mojo.Event.dragEnd, this.scrollerDragEndHandler); }
	}
	if (this._scrollTimer) { clearInterval(this._scrollTimer); this._scrollTimer = null; }
	if (this._userScrollTimeout) { clearTimeout(this._userScrollTimeout); this._userScrollTimeout = null; }
	if (this._seekApplyTimer) { clearTimeout(this._seekApplyTimer); }
	if (this._seekClearTimer) { clearTimeout(this._seekClearTimer); }
	// Detach our callbacks so a backgrounded Now Playing scene stops mutating the DOM.
	if (this._pb) {
		this._pb.onTimeUpdate = this._pb.onPlaying = this._pb.onPaused = null;
		this._pb.onBuffering = this._pb.onEnded = this._pb.onError = null;
		this._pb.onTrackChanged = null;
	}
};

NowplayingAssistant.prototype._getTrackSongId = function (track) {
	if (!track) { return null; }
	if (typeof track === "string" || typeof track === "number") {
		return "" + track;
	}
	var id = track.catalogId || track.id || track.libraryId || track.strTrackID;
	return id ? ("" + id) : null;
};

NowplayingAssistant.prototype.loadLyrics = function (track) {
	var self = this;
	var t = (track && typeof track === "object") ? track : (Jukie.currentTrack || {});
	var songId = this._getTrackSongId(track || t);

	if (!songId) {
		this._lyricsState = "unavailable";
		this._lyrics = null;
		this._lyricsSongId = null;
		this._activeLyricIdx = -1;
		this._renderLyricsList();
		this.refreshLyricsMenu();
		return;
	}

	if (this._lyricsSongId === songId) {
		if (this._lyricsState === "loaded" && this._lyrics) {
			this._renderLyricsList();
			if (this._lastPos !== undefined) {
				this.updateLyricsTime(this._lastPos);
			}
			this.refreshLyricsMenu();
			return;
		}
		if (this._lyricsState === "unavailable") {
			this._renderLyricsList();
			this.refreshLyricsMenu();
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
	this.refreshLyricsMenu();

	if (!Jukie.apple) {
		this._lyricsState = "unavailable";
		this._renderLyricsList();
		this.refreshLyricsMenu();
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
		self.refreshLyricsMenu();
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
						if (Jukie.currentTrack && (Jukie.currentTrack.libraryId === songId || Jukie.currentTrack.id === songId)) {
							Jukie.currentTrack.catalogId = catSong.id;
						}
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

NowplayingAssistant.prototype._onLyricsUnavailable = function (songId) {
	if (songId && this._lyricsSongId !== songId) { return; }
	this._lyricsState = "unavailable";
	this._lyrics = null;
	this._activeLyricIdx = -1;
	this._renderLyricsList();
	this.refreshLyricsMenu();
};

NowplayingAssistant.prototype._renderLyricsList = function () {
	var list = this.controller.get("np-lyrics-list");
	if (!list) { return; }
	if (!this._lyrics || !this._lyrics.lines || this._lyrics.lines.length === 0) {
		if (this._lyricsState === "loading") {
			list.innerHTML = '<div class="jukie-np-lyrics-empty">' +
				'<div class="jukie-np-lyrics-empty-title">Loading lyrics…</div>' +
				'</div>';
		} else {
			list.innerHTML = '<div class="jukie-np-lyrics-empty">' +
				'<div class="jukie-np-lyrics-empty-title">No Lyrics Available</div>' +
				'<div class="jukie-np-lyrics-empty-sub">Lyrics aren\'t available for this song.</div>' +
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
		html += '<div class="jukie-np-lyrics-line' + activeClass + '" id="mojo-lyric-line-' + i + '" data-idx="' + i + '"' + beginAttr + ' x-mojo-tap-highlight="momentary">' +
			JukieEmoji.text(line.text).escapeHTML() +
			'</div>';
	}
	if (this._lyrics.songwriters && this._lyrics.songwriters.length > 0) {
		var sw = this._lyrics.songwriters.join(", ");
		html += '<div class="jukie-np-lyrics-songwriters">' +
			'Written by: ' + JukieEmoji.text(sw).escapeHTML() +
			'</div>';
	}
	list.innerHTML = html;
	var scroller = this.controller.get("np-lyrics-scroller");
	if (scroller && scroller.mojo && typeof scroller.mojo.validateScrollPosition === "function") {
		scroller.mojo.validateScrollPosition();
	}

	if (this._activeLyricIdx >= 0) {
		this.scrollActiveLyricIntoView();
	}
};

NowplayingAssistant.prototype.onToggleLyrics = function () {
	this._showingLyrics = !this._showingLyrics;
	try { localStorage.setItem("jukie_lyrics_toggled", this._showingLyrics ? "1" : "0"); } catch (e) {}
	var trackView = this.controller.get("np-track-view");
	var lyricsOverlay = this.controller.get("np-lyrics-overlay");

	if (this._showingLyrics) {
		this._userInteractingLyrics = false;
		if (this._userScrollTimeout) {
			clearTimeout(this._userScrollTimeout);
			this._userScrollTimeout = null;
		}
		if (trackView) { trackView.style.display = "none"; }
		if (lyricsOverlay) {
			lyricsOverlay.style.display = "block";
			this.layout();
			var scroller = this.controller.get("np-lyrics-scroller");
			if (scroller && scroller.mojo && typeof scroller.mojo.validateScrollPosition === "function") {
				scroller.mojo.validateScrollPosition();
			}
			this.updateLyricsMeta();
			if (this._lastPos !== undefined && this._lyrics && this._lyrics.lines) {
				this._activeLyricIdx = -1;
				this.updateLyricsTime(this._lastPos);
			} else if (this._activeLyricIdx >= 0) {
				this._setLineActive(this._activeLyricIdx, true);
				this.scrollActiveLyricIntoView();
			}
		}
	} else {
		if (lyricsOverlay) { lyricsOverlay.style.display = "none"; }
		if (trackView) { trackView.style.display = "block"; }
		this.layout();
	}
	this.refreshLyricsMenu();
};

NowplayingAssistant.prototype.updateLyricsMeta = function () {
	var el = this.controller.get("np-lyrics-track");
	if (!el) { return; }
	var track = Jukie.currentTrack || {};
	var title = track.title || "Unknown";
	var artist = track.artist || "";
	var meta = JukieEmoji.text(title).escapeHTML();
	if (artist) {
		meta += ' &middot; <span class="jukie-np-lyrics-meta-artist">' + JukieEmoji.text(artist).escapeHTML() + '</span>';
	}
	el.innerHTML = meta;
};

NowplayingAssistant.prototype._setLineActive = function (idx, active) {
	if (idx < 0) { return; }
	var el = this.controller.get("mojo-lyric-line-" + idx) || document.getElementById("mojo-lyric-line-" + idx);
	if (!el) {
		var list = this.controller.get("np-lyrics-list");
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

NowplayingAssistant.prototype._smoothScrollTo = function (container, targetY, duration) {
	if (!container) { return; }
	if (this._scrollTimer) {
		clearInterval(this._scrollTimer);
		this._scrollTimer = null;
	}
	var startY = container.scrollTop;
	var diff = targetY - startY;
	if (Math.abs(diff) < 2) {
		container.scrollTop = targetY;
		return;
	}
	var startTime = new Date().getTime();
	var animDur = duration || 250;
	var self = this;
	this._scrollTimer = setInterval(function () {
		var elapsed = new Date().getTime() - startTime;
		var p = Math.min(1, elapsed / animDur);
		// Ease-out cubic curve
		var ease = 1 - Math.pow(1 - p, 3);
		container.scrollTop = Math.round(startY + diff * ease);
		if (p >= 1) {
			clearInterval(self._scrollTimer);
			self._scrollTimer = null;
		}
	}, 25);
};

NowplayingAssistant.prototype.scrollActiveLyricIntoView = function () {
	if (!this._showingLyrics || this._activeLyricIdx < 0 || this._userInteractingLyrics) { return; }
	var list = this.controller.get("np-lyrics-list");
	var scroller = this.controller.get("np-lyrics-scroller");
	if (!list || !scroller) { return; }
	var activeEl = this.controller.get("mojo-lyric-line-" + this._activeLyricIdx) ||
		document.getElementById("mojo-lyric-line-" + this._activeLyricIdx);
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
		} else {
			this._smoothScrollTo(scroller, targetY, 250);
		}
	}
};

NowplayingAssistant.prototype.updateLyricsTime = function (pos) {
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

NowplayingAssistant.prototype.onLyricLineTap = function (event) {
	var target = event.target;
	var list = this.controller.get("np-lyrics-list");
	while (target && target !== list) {
		if (target.className && target.className.indexOf("jukie-np-lyrics-line") !== -1) {
			break;
		}
		target = target.parentNode;
	}
	if (!target || !target.className || target.className.indexOf("jukie-np-lyrics-line") === -1) { return; }
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
