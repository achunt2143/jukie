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
};

// Fit the scene to the real screen: on screens taller than 480px-class cards, switch to the
// stretched .is-tall layout (see jukie.css) and grow the art with the free space. Re-run on
// every window resize, because the Slider only positions its knob in modelChanged() - after
// a resize while paused it would otherwise stay where the old width put it.
NowplayingAssistant.prototype.layout = function () {
	var root = this.controller.get("np-root");
	var art = this.controller.get("np-art");
	if (!root || !art) { return; }
	var w = window.innerWidth, h = window.innerHeight;
	var tall = h > 500;
	var size = 150;
	if (tall) {
		root.addClassName("is-tall");
		root.style.minHeight = (h - 52) + "px";
		size = Math.max(150, Math.min(w - 64, h - 330));
	} else {
		root.removeClassName("is-tall");
		root.style.minHeight = "";
	}
	art.style.width = art.style.height = size + "px";
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
	var track = Jukie.currentTrack || {};
	this.controller.get("np-title").update(JukieEmoji.text(track.title || "Unknown").escapeHTML());
	this.controller.get("np-artist").update(JukieEmoji.text(track.artist || "").escapeHTML());
	this.controller.get("np-album").update(JukieEmoji.text(track.album || "").escapeHTML());
	// Jukie.artUrl fills the {w}x{h} template AND forces http - https to Apple hosts
	// cannot handshake on this device, so an https URL here renders as an empty box.
	var art = Jukie.artUrl(track.artUrl, this._artPx);
	this.controller.get("np-art").style.backgroundImage = art ? ("url('" + art + "')") : "";
	if (this.appMenuModel) { this.refreshOfflineMenu(); }
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
	// "large" is 128px (per the SDK's Spinner reference) - massively bigger than our
	// 64px button, which is exactly why it swallowed the whole controls row. "small"
	// is 32px, sized to actually sit inside the button.
	this.controller.setupWidget("np-spinner", { spinnerSize: "small" }, this.spinnerModel);

	// Transport: prev / play-pause / next.
	this.ppHandler = this.onPlayPause.bindAsEventListener(this);
	this.controller.get("np-playpause").observe(Mojo.Event.tap, this.ppHandler);
	this.prevHandler = this.onPrev.bindAsEventListener(this);
	this.controller.get("np-prev").observe(Mojo.Event.tap, this.prevHandler);
	this.nextHandler = this.onNext.bindAsEventListener(this);
	this.controller.get("np-next").observe(Mojo.Event.tap, this.nextHandler);

	// Attach to the playback service's live callbacks for the lifetime of this scene.
	var self = this;
	this._pb = Jukie.playback;
	this._pb.onTimeUpdate = function (p) { self.onTimeUpdate(p); };
	// No "Paused" text: the button itself (bars vs. triangle) already shows that, and a
	// persistent status line under it was redundant.
	this._pb.onPlaying = function () { self.setPlayingUI(true); self.setBuffering(false); self.setState(""); };
	this._pb.onPaused = function () { self.setPlayingUI(false); self.setBuffering(false); self.setState(""); };
	// No "Buffering…" text either: the service reports buffering optimistically the
	// instant play/resume/skip is tapped (before jukie-drm's fetch+decrypt even starts),
	// and previously nothing ever cleared the text once playback actually got going -
	// onPlaying and onBuffering(false) can each fire independently and neither one
	// necessarily follows the other, so text set by one stuck around after the other. A
	// spinner over the button reflects the SAME live buffering flag without that problem:
	// showing it is idempotent no matter which callback fires first.
	this._pb.onBuffering = function (p) { self.setBuffering(p.buffering); };
	this._pb.onEnded = function () { self.setPlayingUI(false); self.setBuffering(false); self.setState("Finished"); self.updateTimes(0, self._duration || 0); };
	this._pb.onError = function (p) {
		self.setPlayingUI(false); self.setBuffering(false);
		var offlineMiss = p && typeof p.error === "string" && p.error.indexOf("not available offline") === 0;
		self.setState(offlineMiss ? "Not available offline" : "Playback error");
	};
	// Auto-advance (PlaybackService's own "ended" handling) moves to a new track without
	// this scene ever calling renderTrack() itself - onEnded above fires for the OLD
	// track's end, before the new one is even loaded, so it can't repaint the new one.
	this._pb.onTrackChanged = function () { self.renderTrack(); };

	// App menu: save the current track for offline play / remove it. The label follows the
	// track's state, so it is refreshed whenever the track or the offline sets change.
	this.appMenuModel = { visible: true, items: [{ label: "Save for offline", command: "do-offline" }] };
	this.controller.setupWidget(Mojo.Menu.appMenu, { omitDefaultItems: true }, this.appMenuModel);
	this.offlineWatcher = this.refreshOfflineMenu.bind(this);
	Jukie.watchOffline(this.offlineWatcher);
	this.refreshOfflineMenu();

	// Initial UI from whatever the service already reports.
	this.setPlayingUI(this._pb.isPlaying());
	this.setBuffering(this._pb.isBuffering());
	this.setState("");
};

NowplayingAssistant.prototype.refreshOfflineMenu = function () {
	var track = Jukie.currentTrack || {};
	var saved = !!(track.catalogId && Jukie.savedIds[track.catalogId]);
	this.appMenuModel.items[0].label = saved ? "Remove from offline" : "Save for offline";
	this.appMenuModel.items[0].disabled = !track.catalogId;
	try { this.controller.modelChanged(this.appMenuModel); } catch (e) { /* menu not instantiated yet */ }
};

NowplayingAssistant.prototype.handleCommand = function (event) {
	if (event.type !== Mojo.Event.command || event.command !== "do-offline") { return; }
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
};

NowplayingAssistant.prototype.updateTimes = function (pos, dur) {
	this.controller.get("np-elapsed").innerHTML = this._fmtTime(pos);
	this.controller.get("np-duration").innerHTML = this._fmtTime(dur);
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
	if (el) { el.innerHTML = text || ""; }
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
};

NowplayingAssistant.prototype.cleanup = function () {
	this._active = false;
	Jukie.unwatchOffline(this.offlineWatcher);
	window.removeEventListener("resize", this.layoutHandler, false);
	this.controller.get("seekSlider").stopObserving(Mojo.Event.propertyChange, this.seekHandler);
	this.controller.get("np-playpause").stopObserving(Mojo.Event.tap, this.ppHandler);
	this.controller.get("np-prev").stopObserving(Mojo.Event.tap, this.prevHandler);
	this.controller.get("np-next").stopObserving(Mojo.Event.tap, this.nextHandler);
	if (this._seekApplyTimer) { clearTimeout(this._seekApplyTimer); }
	if (this._seekClearTimer) { clearTimeout(this._seekClearTimer); }
	// Detach our callbacks so a backgrounded Now Playing scene stops mutating the DOM.
	if (this._pb) {
		this._pb.onTimeUpdate = this._pb.onPlaying = this._pb.onPaused = null;
		this._pb.onBuffering = this._pb.onEnded = this._pb.onError = null;
		this._pb.onTrackChanged = null;
	}
};
