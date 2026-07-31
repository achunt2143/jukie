/*globals Mojo, Jukie, setInterval, clearInterval, Date */
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
 * No scrubber, no volume - deliberately minimal, matching the sibling Enyo app's own
 * Exhibition Mode design (meant to be glanced at from across a room, not interacted with).
 */
var ExhibitionAssistant = function () {
	this._clockTimer = null;
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
	this.controller.get("exh-title").update((track.title || "Unknown").escapeHTML());
	this.controller.get("exh-artist").update((track.artist || "").escapeHTML());
	this.controller.get("exh-album").update((track.album || "").escapeHTML());
	// Larger than Now Playing's art fetch (300) since this is a full-bleed background,
	// not a bounded thumbnail. Jukie.artUrl also forces http - see its own note.
	var art = Jukie.artUrl(track.artUrl, 640);
	this.controller.get("exh-art").style.backgroundImage = art ? ("url('" + art + "')") : "";
};

// TEMPORARY: wrapped in try/catch with explicit logging while diagnosing a silent blank
// screen on this scene - unlike the List widget, this framework build does NOT
// auto-catch-and-log an assistant's own setup() exceptions, so a real bug here would
// otherwise abort rendering with nothing in palm-log/messages to explain why. Remove
// this wrapper once the scene is confirmed working; every other assistant in this app
// is deliberately left unwrapped.
ExhibitionAssistant.prototype.setup = function () {
	try {
		this._setupInner();
	} catch (e) {
		Mojo.Log.error("[Exhibition] setup() threw: " + e + (e && e.stack ? ("\n" + e.stack) : ""));
	}
};

ExhibitionAssistant.prototype._setupInner = function () {
	// Unconditional checkpoint (not just the catch-block error above) - the previous round
	// of "nothing shows" had no crash either, so a log line that proves setup() actually
	// ran (vs. never being reached at all) is the fact that's actually missing right now.
	Mojo.Log.info("[Exhibition] setup() entered");

	// Palm's own SDK sample (SDK/share/samplecode/mojo/ExhibitionMode) sizes its scene
	// root with explicit width/height read from the window rather than relying on a
	// height:100% cascade from html/body/.palm-scene (its scene html even hardcodes
	// width/height attributes on the root div). A freshly created "dockMode"-typed stage
	// is not guaranteed to carry the same ancestor-height chain a normal card stage does,
	// so this scene's position:absolute + inset:0 full-bleed layers could be resolving
	// against a zero-height containing block - no JS error, just nothing visible, which
	// matches exactly what's been reported. Stamping explicit pixel dimensions on the
	// scene root sidesteps that ancestor chain entirely, matching the sample's approach.
	var scene = this.controller.get("exh-scene");
	if (scene && this.controller.window) {
		scene.style.width = this.controller.window.innerWidth + "px";
		scene.style.height = this.controller.window.innerHeight + "px";
	}

	this.renderTrack();

	this.spinnerModel = { spinning: false };
	this.controller.setupWidget("exh-spinner", { spinnerSize: "small" }, this.spinnerModel);

	// Transport: prev / play-pause / next - identical calls to NowplayingAssistant's.
	this.ppHandler = this.onPlayPause.bindAsEventListener(this);
	this.controller.get("exh-playpause").observe(Mojo.Event.tap, this.ppHandler);
	this.prevHandler = this.onPrev.bindAsEventListener(this);
	this.controller.get("exh-prev").observe(Mojo.Event.tap, this.prevHandler);
	this.nextHandler = this.onNext.bindAsEventListener(this);
	this.controller.get("exh-next").observe(Mojo.Event.tap, this.nextHandler);

	// Tap the background (art layer) to exit. A tap only ever lands on whichever
	// element is topmost at that screen point, so tapping a transport button (drawn on
	// top, in .jukie-exh-content) never reaches this handler - no hit-testing needed.
	this.bgHandler = this.onBackgroundTap.bindAsEventListener(this);
	this.controller.get("exh-art").observe(Mojo.Event.tap, this.bgHandler);

	// Attach to the playback service's live callbacks - identical wiring to
	// NowplayingAssistant.setup(), just updating this scene's own elements.
	var self = this;
	this._pb = Jukie.playback;
	this._pb.onTimeUpdate = function (p) { self.onTimeUpdate(p); };
	this._pb.onPlaying = function () { self.setPlayingUI(true); self.setBuffering(false); };
	this._pb.onPaused = function () { self.setPlayingUI(false); self.setBuffering(false); };
	this._pb.onBuffering = function (p) { self.setBuffering(p.buffering); };
	this._pb.onEnded = function () { self.setPlayingUI(false); self.setBuffering(false); self.updateTimes(0, self._duration || 0); };
	this._pb.onError = function () { self.setPlayingUI(false); self.setBuffering(false); };
	// Auto-advance (PlaybackService's own "ended" handling) moves to a new track without
	// this scene ever calling renderTrack() itself - see NowplayingAssistant's identical
	// wiring for the full explanation.
	this._pb.onTrackChanged = function () { self.renderTrack(); };

	// Optimistic paint from whatever's cached (avoids a blank flash), immediately
	// corrected by the real fetch below - this scene's own PlaybackService instance may
	// never have had play()/resume() called on it directly (the track is commonly
	// started from the main app's stage instead), so its cached state can be stale/wrong
	// until refreshStatus() hears back from the shared backend.
	this.setPlayingUI(this._pb.isPlaying());
	this.setBuffering(this._pb.isBuffering());
	this._pb.refreshStatus();

	// Clock: h:mm AM/PM, ticking every second - direct port of the Enyo exhibition
	// view's _tickClock (12-hour, no leading zero on the hour, zero-padded minutes).
	this._tickClock();
	this._clockTimer = setInterval(this._tickClock.bind(this), 1000);

	Mojo.Log.info("[Exhibition] setup() completed");
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
};

ExhibitionAssistant.prototype.updateTimes = function (pos, dur) {
	this.controller.get("exh-elapsed").innerHTML = this._fmtTime(pos);
	this.controller.get("exh-duration").innerHTML = this._fmtTime(dur);
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
ExhibitionAssistant.prototype.onBackgroundTap = function () {
	this.controller.window.close();
};

ExhibitionAssistant.prototype.cleanup = function () {
	this.controller.get("exh-playpause").stopObserving(Mojo.Event.tap, this.ppHandler);
	this.controller.get("exh-prev").stopObserving(Mojo.Event.tap, this.prevHandler);
	this.controller.get("exh-next").stopObserving(Mojo.Event.tap, this.nextHandler);
	this.controller.get("exh-art").stopObserving(Mojo.Event.tap, this.bgHandler);
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
