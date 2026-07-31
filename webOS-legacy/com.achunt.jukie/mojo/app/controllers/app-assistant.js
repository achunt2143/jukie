/*globals Mojo, Db8Service, SettingsService, AppleMusicService, LibraryCacheService, PlaybackService, WebToken */
/*
 * AppAssistant - app-scope bootstrap. Instantiates Jukie's shared model layer (the
 * ported utility/ services) once, loads saved settings, pushes credentials to the
 * playback/DRM service, and auto-refreshes the public Apple web token. Scenes reach the
 * models through the global `Jukie` singleton below.
 *
 * Stage architecture: matches Palm's own SDK sample
 * (SDK/share/samplecode/mojo/ExhibitionMode), NOT the "framework auto-creates a main
 * stage" model this file used before. appinfo.json sets "noWindow": true, which turns
 * that auto-creation off entirely - there is no default stage, and no StageAssistant.
 * handleLaunch (bottom of this file) is the ONE place responsible for creating either a
 * plain "jukiemain" stage (normal launch - deliberately NOT named "main", see
 * handleLaunch's own comment) or a "dock" stage typed "dockMode" (Exhibition
 * launch) via createStageWithCallback. The dockMode stage TYPE is what gets the real
 * chrome-free, no-status-bar presentation from the system - it is NOT something a scene
 * can toggle on afterwards (enableFullScreenMode was tried and confirmed NOT sufficient
 * on real hardware: the scene rendered correctly but the normal card status bar stayed
 * on screen, because the scene was still living on an ordinary card-type stage).
 */

// Global singleton holding Jukie's shared model instances, reachable from any scene.
var Jukie = {
	db8: null,
	apple: null,
	settings: null,
	library: null,
	playback: null,
	prefs: null,       // the loaded settings record
	ready: false,      // true once settings loaded + token refresh attempted
	syncing: false     // true while a library sync is in flight
};

var AppAssistant = function (appController) {
	AppAssistant.instance = this;
	this.appController = appController;
	this.initServices();
};

AppAssistant.prototype.initServices = function () {
	Jukie.db8 = new Db8Service();
	Jukie.settings = new SettingsService(Jukie.db8);
	Jukie.apple = new AppleMusicService({ debug: false });
	Jukie.library = new LibraryCacheService(Jukie.apple, Jukie.db8);
	Jukie.playback = new PlaybackService();
	this.bootstrap();
};

// Async: load prefs -> apply tokens -> push credentials to the Luna/DRM service ->
// auto-refresh the ~35-day public web token (no login). Never throws out of here.
AppAssistant.prototype.bootstrap = function () {
	Jukie.settings.load().then(function (prefs) {
		Jukie.prefs = prefs;
		Jukie.apple.setStorefront(prefs.storefront || "us");
		if (prefs.developerToken) { Jukie.apple.setDeveloperToken(prefs.developerToken); }
		if (prefs.musicUserToken) { Jukie.apple.setMusicUserToken(prefs.musicUserToken); }
		// The pasted tokens have to reach jukie-drm (which reads a static secrets file
		// next to itself) via the service - the app has no filesystem access of its own.
		Jukie.playback.setCredentials(prefs.developerToken, prefs.musicUserToken);
		// Token refresh is handled service-side by jukie-drm (this device's browser
		// can't reach Apple over TLS) - see AppleMusicService.ensureDeveloperToken.
		return Jukie.apple.ensureDeveloperToken(false);
	}).then(function (token) {
		if (token) { Jukie.apple.setDeveloperToken(token); }
		// Register the library kind + permissions on every launch. db8 kinds/permissions
		// are wiped by each reinstall, and browsing (unlike sync) never re-registers them,
		// so without this a fresh install shows "db: permission denied" until the first
		// Refresh. Idempotent, so it's cheap to run always. (Settings does the same for
		// its own kind, which is why Settings has always worked.)
		return Jukie.library.ensureSchema();
	}).then(function () {
		Jukie.ready = true;
		Mojo.Log.info("[Jukie] services ready");
	}).catch(function (err) {
		Jukie.ready = true; // don't wedge the UI if bootstrap partially failed
		Mojo.Log.error("[Jukie] bootstrap error: " + err);
	});
};

// Build a real artwork URL from Apple's {w}x{h} template.
//
// Two things have to happen here or artwork silently never appears:
//  1. Substitute the {w}/{h}/{c} placeholders - Apple hands back a template, not a URL.
//  2. Force plain http. This device's TLS stack cannot complete a handshake with ANY
//     Apple host, mzstatic included - measured on-device, https returns status 000 while
//     the identical http request returns 200. (It's the same limitation that makes the
//     whole API go through jukie-drm.) An <img>/background-image pointing at https just
//     fails quietly, which is why every row and the Now Playing art rendered as an empty
//     grey box.
Jukie.artUrl = function (url, px) {
	if (!url) { return ""; }
	px = px || 80;
	return url.replace("{w}", px).replace("{h}", px).replace("{c}", "")
	          .replace(/^https:/, "http:");
};

// ---- play queue ----------------------------------------------------------
// Set when a list row is tapped, so Now Playing's prev/next have something to move
// through. `list` is the tapped scene's full record array (same descriptor shape
// SongsAssistant.handleTap receives).
Jukie.setQueue = function (list, index) {
	Jukie.queue = list || [];
	Jukie.queueIndex = (typeof index === "number") ? index : 0;
};

// Start the queue entry at `index`, skipping in `step` direction over anything that
// isn't playable (library items without a catalogId can't be fetched by jukie-drm).
// Returns true if something started.
Jukie.playAt = function (index, step) {
	var q = Jukie.queue || [];
	step = step || 1;
	while (index >= 0 && index < q.length && !q[index].catalogId) { index += step; }
	if (index < 0 || index >= q.length) { return false; }
	var rec = q[index];
	Jukie.queueIndex = index;
	Jukie.currentTrack = rec;
	Jukie.saveNowPlaying(rec);
	Jukie.playback.load("", rec.catalogId, rec.libraryId);
	Jukie.playback.play();
	return true;
};

// ---- cross-stage now-playing ref ------------------------------------------
// Jukie.currentTrack above is a plain in-memory object, which does NOT reach a scene
// running on a separately created stage: the Exhibition dock stage (created via
// createStageWithCallback with a "dockMode" type - see Jukie.enterExhibition) got
// transport commands working fine (those are real Luna service calls, unaffected by
// this) but showed a blank background and "Unknown" track details, because ITS copy of
// Jukie never had currentTrack set locally. db8, unlike a plain JS global, genuinely is
// shared across stages, so the track's display fields (not the whole queue - that's a
// bigger feature, see the Enyo sibling app's kindPlaybackSession for what full
// cross-window queue/position sync looks like) are mirrored there on every play.
Jukie.NOWPLAYING_KIND = "com.achunt.jukie.nowplaying:1";

Jukie.ensureNowPlayingSchema = function () {
	return Jukie.db8.putKind({
		id: Jukie.NOWPLAYING_KIND,
		owner: "com.achunt.jukie",
		indexes: [{ name: "bySingleton", props: [{ name: "singleton" }] }]
	}).then(function () {
		return Jukie.db8.putPermissions([{
			type: "db.kind", object: Jukie.NOWPLAYING_KIND, caller: "com.achunt.jukie",
			operations: { read: "allow", create: "allow", update: "allow", delete: "allow" }
		}]);
	});
};

Jukie.saveNowPlaying = function (track) {
	if (!track) { return; }
	var rec = {
		_kind: Jukie.NOWPLAYING_KIND, singleton: true,
		catalogId: track.catalogId || "", libraryId: track.libraryId || "",
		title: track.title || "", artist: track.artist || "",
		album: track.album || "", artUrl: track.artUrl || ""
	};
	Jukie.ensureNowPlayingSchema().then(function () {
		return Jukie.db8.del({ from: Jukie.NOWPLAYING_KIND, where: [{ prop: "singleton", op: "=", val: true }] });
	}).then(function () {
		return Jukie.db8.put([rec]);
	}).catch(function (err) { Mojo.Log.error("[Jukie] saveNowPlaying failed: " + err); });
};

// Read it back. Used by scenes (Exhibition) that may be running on a stage other than
// the one that set Jukie.currentTrack, so have no other way to know what's playing.
// Always resolves - null if nothing has ever been saved.
Jukie.loadNowPlaying = function () {
	return Jukie.ensureNowPlayingSchema().then(function () {
		return Jukie.db8.find({ from: Jukie.NOWPLAYING_KIND, where: [{ prop: "singleton", op: "=", val: true }], limit: 1 });
	}).then(function (resp) {
		return (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
	}).catch(function () { return null; });
};

Jukie.playNext = function () { return Jukie.playAt((Jukie.queueIndex || 0) + 1, 1); };
Jukie.playPrev = function () { return Jukie.playAt((Jukie.queueIndex || 0) - 1, -1); };

// ---- Just Type (universalSearch dbsearch) launch handling -----------------
// appinfo.json's universalSearch.dbsearch lets the system launcher query our db8 libitem
// kind directly (no service call to us) and show matches inline in Just Type. Picking a
// result launches us with launchParam "libItemId" = that record's _id. Direct port of the
// Enyo sibling app's source/app.js showLibraryItemById/showLibraryRecord, adapted from
// Enyo's pane-swap navigation to Mojo's scene stack - see handleLaunch below for where
// `stageController` (always the "main" stage, fresh or already-running) comes from.
Jukie.showLibraryItemById = function (stageController, id) {
	Jukie.library.getById(id).then(function (rec) {
		if (!rec) {
			Mojo.Log.warn("[Jukie] Just Type: no library item for id " + id);
			return;
		}
		Jukie.showLibraryRecord(stageController, rec);
	}).catch(function (err) {
		Mojo.Log.error("[Jukie] Just Type: lookup failed: " + err);
	});
};

Jukie.showLibraryRecord = function (stageController, rec) {
	// mainmenu is always already on the stack by the time this runs (handleLaunch pushes
	// it before calling showLibraryItemById on a cold launch; it's already there from
	// before on a warm one) - so this only ever needs to push the deep-linked scene ON
	// TOP of it, never re-push mainmenu itself.
	switch (rec.itemType) {
	case "song":
		// Auto-play: a single-track queue starting immediately, exactly like tapping the
		// row in the Songs list would (SongsAssistant.handleTap).
		var track = {
			catalogId: rec.catalogId || "", libraryId: rec.libId || "",
			title: rec.name || "", artist: rec.artistName || "",
			album: rec.albumName || "", artUrl: rec.artworkUrl || ""
		};
		if (!track.catalogId) { return; } // no catalog id - nothing playable, land on mainmenu
		Jukie.setQueue([track], 0);
		Jukie.playAt(0, 1);
		stageController.pushScene("nowplaying");
		break;
	case "album":
		stageController.pushScene("songs", { albumName: rec.name, artistName: rec.artistName, title: rec.name });
		break;
	case "artist":
		stageController.pushScene("songs", { artistName: rec.name, title: rec.name });
		break;
	default:
		// Playlists aren't deep-linkable (their tracks live nested on the playlist's own
		// libitem record, not filterable by album/artist name the way SongsAssistant
		// filters song lists) - land on mainmenu (already on the stack) rather than doing
		// nothing, matching the Enyo sibling's own fallback intent.
		break;
	}
};

// Whether a launch is a Touchstone dock/Exhibition launch. Under noWindow there is no
// auto-created stage and no StageAssistant racing handleLaunch for this information -
// handleLaunch is the only caller, and it always gets an accurate params object for
// THAT SPECIFIC launch, so (unlike an earlier version of this function) no fallback to
// stale launch data is needed or wanted.
Jukie.isDockLaunch = function (params) {
	return !!(params && (params.dockMode || params.touchstoneMode));
};

// Create the dedicated Exhibition stage, or bring it to front if it's already running.
// Shared by handleLaunch's real dock-launch path AND the manual "Exhibition Mode" app-
// menu entry (mainmenu-assistant.js), so testing without a physical dock exercises the
// exact same stage-creation path a real dock launch does.
Jukie.enterExhibition = function () {
	var app = Mojo.Controller.getAppController();
	var dockStage = app.getStageController("dock");
	if (dockStage) {
		// Re-entering an existing dock stage (exited once already, or a second dock event
		// without an app relaunch in between) must not just bring it forward showing
		// whatever ExhibitionAssistant instance was left over from last time - that's
		// exactly the "stale track details" bug. swapScene() turned out NOT to reliably do
		// this (confirmed - still stale after switching to it). Palm's own docs
		// (dev-guide/mojo/basics-stages.html, "Creating a Secondary (Child) Stage") give the
		// official pattern for reusing a stage across multiple entries: popScenesTo() (clear
		// the stack) + pushScene() (a genuinely fresh scene/assistant, not a reused one) +
		// activate() (bring the stage forward) - not swapScene, and not window.focus().
		dockStage.popScenesTo();
		dockStage.pushScene("exhibition");
		dockStage.activate();
		return;
	}
	// "dockMode" (3rd arg) is a STAGE TYPE, not a per-scene setting - it's what tells the
	// system to give this stage the real chrome-free Exhibition presentation. Matches
	// Palm's own SDK sample (SDK/share/samplecode/mojo/ExhibitionMode/app/assistants/
	// app-assistant.js's launchTouchstone) exactly.
	app.createStageWithCallback({ name: "dock", lightweight: true }, function (stageController) {
		Mojo.Log.info("[Exhibition] dock stage created, pushing scene");
		stageController.pushScene("exhibition");
	}, "dockMode");
};

// jukie-drm's executable bit not surviving packaging/install on this device (confirmed on
// a real Pre2 even with the package-level chmod fix - see JukieAudioService.js's own
// comment and post-install-jukie.ps1) is a real, recurring failure mode with a real,
// on-device fix - so surface it as an actionable message instead of a generic "playback
// error" nobody can act on. Called from PlaybackService's "error" state handling
// (playback-service.js), which is why this lives here rather than in a scene: it has to
// fire no matter which scene is on screen (same reasoning as Jukie.enterExhibition/
// playNext above - a scene-local onError callback can't guarantee that).
Jukie.showPermissionErrorDialog = function () {
	var app = Mojo.Controller.getAppController();
	var stage = app.getStageController("jukiemain") || app.getStageController("dock");
	var scene = stage && stage.activeScene();
	if (!scene) {
		Mojo.Log.error("[Jukie] permission-error dialog: no active scene to show it on");
		return;
	}
	scene.showAlertDialog({
		title: "Permissions bug",
		message: "Hey!! Looks like you've ran into the permissions bug! Plug me in to " +
			"novaterm and run this command: chmod +x " +
			"/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos2 " +
			"/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos3",
		choices: [{ label: "OK", value: "ok" }]
	});
};

// Kick a library sync (Apple -> db8). Guarded so overlapping requests don't stack.
// onDone(errorOrNull) is optional. Requires a musicUserToken (personal library).
AppAssistant.startLibrarySync = function (onDone, onProgress) {
	if (Jukie.syncing) {
		if (onDone) { onDone(new Error("sync already in progress")); }
		return;
	}
	if (!Jukie.apple.musicUserToken) {
		if (onDone) { onDone(new Error("no Music User Token set - add one in Preferences")); }
		return;
	}
	Jukie.syncing = true;
	Jukie.library.onProgress = onProgress || null;
	function finish(err) {
		Jukie.syncing = false;
		Jukie.library.onProgress = null;
		if (err) { Mojo.Log.error("[Jukie] library sync failed: " + err); }
		if (onDone) { onDone(err || null); }
	}
	Jukie.library.sync().then(function () { finish(null); }).catch(finish);
};

// The only place stages get created (noWindow means the framework won't auto-create one).
// Dock/Exhibition launches get their own dedicated stage via Jukie.enterExhibition();
// everything else gets (or refocuses) the normal main card stage - named "jukiemain",
// NOT "main". Confirmed on real Pre2 hardware: now that this app is reached via the
// unified package's device-detecting switcher (com.achunt.jukie/index.html) instead of
// being the system's own literal launch entry, the OS's own launch bookkeeping for that
// entry already occupies the name "main" on the underlying stage/window this script
// runs in - createStageWithCallback({name:"main"}) then fails outright ("cannot create
// two stages with the same name : main") the very first time it's called, even though
// getStageController("main") (this app's own JS-level view) correctly reports nothing
// yet exists. A JS-level "does it already exist" guard can't fix a naming collision at
// that lower level, so this stage is simply given a name that can't collide with
// whatever the system implicitly reserves. There is no StageAssistant in this app -
// Palm's own ExhibitionMode sample doesn't define one either under noWindow, since
// there's no default stage for it to assist.
AppAssistant.prototype.handleLaunch = function (params) {
	if (Jukie.isDockLaunch(params)) {
		Jukie.enterExhibition();
		return;
	}
	var app = Mojo.Controller.getAppController();
	var mainStage = app.getStageController("jukiemain");
	if (mainStage) {
		// activate(), not window.focus() - the documented call for bringing an existing
		// stage forward (dev-guide/mojo/basics-stages.html); unlike the dock stage's
		// reentry above, "main" should NOT clear its scene stack on every relaunch (that
		// would blow away whatever the user was navigating, e.g. mid-Songs-list).
		mainStage.activate();
		// Warm relaunch from Just Type - app was already running. mainmenu is already on
		// the stack from before, so this only needs to push the deep-linked scene.
		if (params && params.libItemId) { Jukie.showLibraryItemById(mainStage, params.libItemId); }
		return;
	}
	app.createStageWithCallback({ name: "jukiemain", lightweight: true }, function (stageController) {
		stageController.pushScene("mainmenu");
		// Stop playback when the card is actually closed/swiped away - the app-level
		// cleanup() below is NOT enough on its own: under noWindow, AppAssistant lives in
		// the permanently-hidden background window, which the user swiping away the
		// VISIBLE "main" card does not necessarily tear down (that's just this one stage's
		// own window closing). window's "unload" is the same raw, framework-agnostic
		// signal the Enyo sibling app's own confirmed-working fix relies on
		// (ApplicationEvents' onUnload is just this event under the hood - see
		// framework/enyo/1.0/framework/source/palm/system/dashboard-window/
		// DashboardContent.js's own comment on the same trick), so it's used directly here
		// rather than trusting any Mojo-specific lifecycle hook to fire reliably.
		stageController.window.addEventListener("unload", function () {
			if (Jukie.playback) { Jukie.playback.stop(); }
		});
		// Cold-launched from Just Type (universalSearch dbsearch) - a library result was
		// tapped; go straight to it instead of leaving the user on the plain mainmenu.
		if (params && params.libItemId) { Jukie.showLibraryItemById(stageController, params.libItemId); }
	});
};

// Defensive backstop for the rarer case of the WHOLE app (hidden window included, not
// just the visible "main" stage - see handleLaunch's unload listener, which is the
// primary fix for the common swipe-away case) being torn down.
AppAssistant.prototype.cleanup = function () {
	if (Jukie.playback) { Jukie.playback.stop(); }
};
