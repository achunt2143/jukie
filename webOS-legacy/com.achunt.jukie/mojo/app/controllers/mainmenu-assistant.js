/*globals Mojo, Jukie, AppAssistant */
/*
 * MainmenuAssistant - Jukie's library landing scene. Lists Songs/Albums/Artists/
 * Playlists (browsed from the db8 library cache) plus a catalog Search entry. The app
 * menu offers Preferences and Refresh Library (re-pull from Apple into db8). All
 * local-media concepts from Palm's sample (indexing spinner, MSM watch, music-store
 * launch, shuffle-all) are intentionally dropped - Jukie's library is Apple's, not the
 * device's local files.
 */
var MainmenuAssistant = function () {};

MainmenuAssistant.prototype.setup = function () {
	// App menu: Preferences + Refresh Library + a manual Exhibition Mode entry (lets it
	// be tested/used without a physical Touchstone dock - same convenience the sibling
	// Enyo app's AppMenu offers).
	this.appMenuModel = {
		visible: true,
		items: [
			{ label: "Preferences", command: "do-prefs" },
			{ label: "Refresh Library", command: "do-refresh" },
			{ label: "Exhibition Mode", command: "do-exhibition" }
		]
	};
	this.controller.setupWidget(Mojo.Menu.appMenu, { omitDefaultItems: true }, this.appMenuModel);

	// Busy spinner for the full-screen refresh scrim.
	this.spinnerModel = { spinning: false };
	this.controller.setupWidget("sync-spinner", { spinnerSize: "large" }, this.spinnerModel);

	// Menu row taps.
	this.tapHandler = this.handleSelection.bindAsEventListener(this);
	this.controller.get("option-list").observe(Mojo.Event.tap, this.tapHandler);

	// Now Playing button (only meaningful once something is loaded).
	this.nowPlayingTap = function () { this.controller.stageController.pushScene("nowplaying"); }.bind(this);
	this.controller.get("now-playing-button").observe(Mojo.Event.tap, this.nowPlayingTap);
};

MainmenuAssistant.prototype.activate = function () {
	this.updateNowPlayingButton();
	this.updateStatus();
};

MainmenuAssistant.prototype.updateNowPlayingButton = function () {
	var show = Jukie.playback && (Jukie.playback.isPlaying() || Jukie.playback._songId);
	this.controller.get("now-playing-button").style.display = show ? "block" : "none";
};

// Show the cached song count (a cheap read from db8) as the library-status divider's
// caption, and reveal the empty-library helper if there's nothing cached yet. The
// divider's own CSS (.palm-divider .label) already uppercases whatever text goes here.
MainmenuAssistant.prototype.updateStatus = function () {
	var self = this;
	if (!Jukie.library) { return; }
	Jukie.library.count("song").then(function (n) {
		var label = self.controller.get("library-status-label");
		var empty = self.controller.get("empty-hint");
		if (n > 0) {
			label.innerHTML = n + " Songs";
			empty.style.display = "none";
		} else {
			label.innerHTML = "";
			empty.style.display = "block";
		}
	}).catch(function () { /* db8 not ready yet; leave as-is */ });
};

MainmenuAssistant.prototype.handleSelection = function (event) {
	// Get a Prototype-extended element for the tapped node, then walk up to the .palm-row
	// that carries the id (same pattern as Palm's sample mainmenu-assistant).
	var row = this.controller.get(event.target);
	if (row && !row.hasClassName("palm-row")) {
		row = row.up("div.palm-row");
	}
	if (!row || !row.id) { return; }

	switch (row.id) {
	case "songs":
	case "albums":
	case "artists":
	case "playlists":
		this.controller.stageController.pushScene(row.id);
		break;
	case "search":
		this.controller.stageController.pushScene("search");
		break;
	}
};

MainmenuAssistant.prototype.handleCommand = function (event) {
	if (event.type !== Mojo.Event.command) { return; }
	switch (event.command) {
	case "do-prefs":
		this.controller.stageController.pushScene("preferences");
		break;
	case "do-refresh":
		this.refreshLibrary();
		break;
	case "do-exhibition":
		// Goes through the same dedicated-stage path a real dock launch uses (see
		// Jukie.enterExhibition in app-assistant.js) rather than pushing the scene onto
		// this card's own stage, so manual testing actually exercises the real mechanism.
		Jukie.enterExhibition();
		break;
	}
};

MainmenuAssistant.prototype.refreshLibrary = function () {
	var self = this;
	if (Jukie.syncing) {
		this.controller.showAlertDialog({
			title: "Sync in progress", message: "A library refresh is already running.",
			choices: [{ label: "OK", value: "ok" }]
		});
		return;
	}
	this.showSyncScrim(true);
	this.setSyncMessage("Refreshing library…");
	AppAssistant.startLibrarySync(function (err) {
		self.showSyncScrim(false);
		if (err) {
			self.controller.get("library-status").innerHTML = "Refresh failed";
			self.controller.showAlertDialog({
				title: "Refresh failed",
				message: (err && err.message) ? err.message : "Could not sync your library.",
				choices: [{ label: "OK", value: "ok" }]
			});
		} else {
			self.updateStatus();
		}
	}, function (msg) {
		self.setSyncMessage(msg);
	});
};

// Full-screen scrim + spinner while a refresh runs: the sync takes a while (every
// API page is a separate process spawn on this device), and blocking interaction
// is both honest about that and prevents a second sync being kicked off underneath.
MainmenuAssistant.prototype.showSyncScrim = function (show) {
	var div = this.controller.get("syncing-div");
	if (!div) { return; }
	div.style.display = show ? "block" : "none";
	this.spinnerModel.spinning = !!show;
	this.controller.modelChanged(this.spinnerModel);
};

// Called by the sync as each stage finishes so the scrim isn't just a blank wait.
MainmenuAssistant.prototype.setSyncMessage = function (text) {
	var el = this.controller.get("sync-message");
	if (el) { el.innerHTML = text || ""; }
};

MainmenuAssistant.prototype.cleanup = function () {
	this.controller.get("option-list").stopObserving(Mojo.Event.tap, this.tapHandler);
	this.controller.get("now-playing-button").stopObserving(Mojo.Event.tap, this.nowPlayingTap);
};
