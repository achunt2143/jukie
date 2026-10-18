/*globals Mojo, Jukie, AppAssistant */
/*
 * PreferencesAssistant - token + option entry. Persists to db8 via SettingsService,
 * applies the tokens to AppleMusicService (catalog/library browsing) AND pushes them to
 * the Luna/DRM service via PlaybackService.setCredentials (so jukie-drm can auth for
 * full-track playback). Also offers Refresh Library and Clear Cache.
 */
var PreferencesAssistant = function () {};

PreferencesAssistant.prototype.STOREFRONTS = [
	{ label: "United States", value: "us" },
	{ label: "United Kingdom", value: "gb" },
	{ label: "Canada", value: "ca" },
	{ label: "Australia", value: "au" },
	{ label: "Germany", value: "de" },
	{ label: "France", value: "fr" },
	{ label: "Japan", value: "jp" }
];

PreferencesAssistant.prototype.SEARCH_LIMITS = [
	{ label: "5 results", value: 5 },
	{ label: "10 results", value: 10 },
	{ label: "15 results", value: 15 },
	{ label: "20 results", value: 20 },
	{ label: "25 results", value: 25 }
];

// Track cache size choices, in MB. 0 keeps only the track being played; tracks saved for
// offline play are never evicted and don't count against this limit.
PreferencesAssistant.prototype.CACHE_SIZES = [
	{ label: "Off (current track only)", value: 0 },
	{ label: "128 MB", value: 128 },
	{ label: "256 MB", value: 256 },
	{ label: "512 MB", value: 512 },
	{ label: "1 GB", value: 1024 },
	{ label: "2 GB", value: 2048 },
	{ label: "4 GB", value: 4096 },
	{ label: "8 GB", value: 8192 }
];

PreferencesAssistant.prototype.fmtBytes = function (b) {
	var mb = (b || 0) / 1048576;
	if (mb >= 1024) { return (Math.round(mb / 102.4) / 10) + " GB"; }
	return (mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)) + " MB";
};

// "In use: 312 MB · Saved offline: 2 songs (15 MB)" - straight from the service's files.
PreferencesAssistant.prototype.refreshCacheUsage = function () {
	var self = this;
	Jukie.playback.getCacheInfo(function (r) {
		var el = self.controller.get("cacheUsage");
		if (!el) { return; }
		if (!r || r.returnValue === false) { el.innerHTML = ""; return; }
		var n = r.pinnedCount || 0;
		el.innerHTML = "In use: " + self.fmtBytes(r.usedBytes) + " &middot; Saved offline: " +
			n + (n === 1 ? " song" : " songs") + " (" + self.fmtBytes(r.pinnedBytes) + ")";
	});
};

PreferencesAssistant.prototype.setup = function () {
	Jukie.setupBack(this.controller);
	var prefs = Jukie.prefs || Jukie.settings.defaults();

	// The tokens are never shown or edited: they ride along as plain state so Save writes them back.
	this.devModel = { value: prefs.developerToken || "" };
	this.musicModel = { value: prefs.musicUserToken || "" };
	this.storeModel = { value: prefs.storefront || "us" };
	this.cacheSizeModel = { value: typeof prefs.cacheLimitMB === "number" ? prefs.cacheLimitMB : 512 };
	this.searchLimitModel = { value: prefs.searchResultLimit || 5 };

	// No `label` attribute here (the framework renders that as small text next
	// to the value, not as a caption) - the field-label div above already says
	// "Storefront", so this just shows the selected value with its dropdown.
	this.controller.setupWidget("storefront", {
		choices: this.STOREFRONTS, modelProperty: "value"
	}, this.storeModel);

	// A limit set some other way (e.g. luna-send) that isn't one of the stock choices still
	// shows up as itself instead of an empty selector.
	var sizeChoices = this.CACHE_SIZES.slice();
	if (!sizeChoices.some(function (c) { return c.value === this.cacheSizeModel.value; }, this)) {
		sizeChoices.push({ label: this.cacheSizeModel.value + " MB", value: this.cacheSizeModel.value });
	}
	this.controller.setupWidget("cacheSize", { choices: sizeChoices, modelProperty: "value" }, this.cacheSizeModel);
	this.refreshCacheUsage();

	// No `label` attribute here either - see the storefront note above.
	this.controller.setupWidget("searchLimit", {
		choices: this.SEARCH_LIMITS, modelProperty: "value"
	}, this.searchLimitModel);

	this.saveModel = { label: "Save", disabled: false };
	this.refreshModel = { label: "Refresh Library", disabled: false };
	this.clearModel = { label: "Clear Cache", disabled: false };
	this.controller.setupWidget("saveBtn", { type: Mojo.Widget.activityButton }, this.saveModel);
	this.controller.setupWidget("refreshBtn", { type: Mojo.Widget.activityButton }, this.refreshModel);
	this.controller.setupWidget("clearCacheBtn", { type: Mojo.Widget.defaultButton }, this.clearModel);

	this.broker = new BrokerService();
	this.signInModel = { label: this.musicModel.value ? "Sign in again" : "Sign in with Apple Music", disabled: false };
	this.controller.get("signedIn").innerHTML = this.musicModel.value ? "Signed in to Apple Music" : "Not signed in";
	this.signInCancelModel = { label: "Cancel", disabled: false };
	this.controller.setupWidget("signInBtn", { type: Mojo.Widget.defaultButton }, this.signInModel);
	this.controller.setupWidget("signInCancelBtn", { type: Mojo.Widget.defaultButton }, this.signInCancelModel);
	this.signInH = this.onSignIn.bind(this);
	this.signInCancelH = this.onSignInCancel.bind(this);
	this.controller.get("signInBtn").observe(Mojo.Event.tap, this.signInH);
	this.controller.get("signInCancelBtn").observe(Mojo.Event.tap, this.signInCancelH);

	this.saveH = this.onSave.bind(this);
	this.refreshH = this.onRefresh.bind(this);
	this.clearH = this.onClearCache.bind(this);
	this.controller.get("saveBtn").observe(Mojo.Event.tap, this.saveH);
	this.controller.get("refreshBtn").observe(Mojo.Event.tap, this.refreshH);
	this.controller.get("clearCacheBtn").observe(Mojo.Event.tap, this.clearH);
};

PreferencesAssistant.prototype.setStatus = function (t) {
	this.controller.get("prefs-status").innerHTML = t || "";
};

// Sign in with Apple Music via the OAuth broker: show a code, the user finishes Apple's sign-in
// on a phone or computer, and the Music User Token comes back here once. Then it is saved
// exactly like a manual paste + Save.
PreferencesAssistant.prototype.onSignIn = function () {
	var self = this;
	this.setStatus("");
	this.signInModel.disabled = true;
	this.controller.modelChanged(this.signInModel);
	this.broker.start({
		onCode: function (info) {
			self.controller.get("signInUrl").innerHTML = self.broker.baseUrl + "/activate.php?app=" +
				encodeURIComponent(self.broker.appName);
			self.controller.get("signInCode").innerHTML = info.code;
			self.controller.get("signInStatus").innerHTML = "Waiting for you to finish signing in…";
			self.controller.get("signInPanel").style.display = "";
		},
		onConnected: function (tokens) {
			var i;
			self.hideSignIn();
			self.musicModel.value = tokens.music_user_token || tokens.access_token;
			self.showSignedIn();
			for (i = 0; i < self.STOREFRONTS.length; i++) {
				if (self.STOREFRONTS[i].value === tokens.storefront) {
					self.storeModel.value = tokens.storefront;
					self.controller.modelChanged(self.storeModel);
					break;
				}
			}
			self.onSave();
		},
		onExpired: function () {
			self.controller.get("signInStatus").innerHTML = "That code expired. Tap Cancel, then sign in again.";
		},
		onError: function (message) {
			self.hideSignIn();
			self.setStatus(message);
		}
	});
};

PreferencesAssistant.prototype.showSignedIn = function () {
	this.controller.get("signedIn").innerHTML = this.musicModel.value ? "Signed in to Apple Music" : "Not signed in";
	this.signInModel.label = this.musicModel.value ? "Sign in again" : "Sign in with Apple Music";
	this.controller.modelChanged(this.signInModel);
};

PreferencesAssistant.prototype.hideSignIn = function () {
	this.broker.stop();
	this.controller.get("signInPanel").style.display = "none";
	this.signInModel.disabled = false;
	this.controller.modelChanged(this.signInModel);
};

PreferencesAssistant.prototype.onSignInCancel = function () {
	this.hideSignIn();
};

PreferencesAssistant.prototype.onSave = function () {
	var self = this;
	var rec = {
		developerToken: (this.devModel.value || "").replace(/\s+/g, ""),
		musicUserToken: (this.musicModel.value || "").replace(/\s+/g, ""),
		storefront: this.storeModel.value || "us",
		cacheLimitMB: this.cacheSizeModel.value,
		streamQuality: (Jukie.prefs && Jukie.prefs.streamQuality) || "high",
		searchResultLimit: this.searchLimitModel.value || 5
	};
	this.setStatus("Saving…");
	Jukie.settings.save(rec).then(function (saved) {
		Jukie.prefs = saved;
		// Apply to catalog/library browsing.
		Jukie.apple.setDeveloperToken(saved.developerToken);
		Jukie.apple.setMusicUserToken(saved.musicUserToken);
		Jukie.apple.setStorefront(saved.storefront);
		// Push to jukie-drm (full-track playback auth) via the service.
		Jukie.playback.setCredentials(saved.developerToken, saved.musicUserToken);
		Jukie.playback.setCacheLimit(saved.cacheLimitMB, function () { self.refreshCacheUsage(); });
		self.setStatus("Saved");
		self.controller.get("saveBtn").mojo.deactivate();
		Mojo.Controller.getAppController().showBanner("Settings saved", {});
	}).catch(function (err) {
		self.setStatus("Save failed");
		self.controller.get("saveBtn").mojo.deactivate();
		Mojo.Log.error("[Prefs] save failed: " + err);
	});
};

PreferencesAssistant.prototype.onRefresh = function () {
	var self = this;
	// Save first so the sync uses the currently-typed tokens.
	this.onSave();
	this.setStatus("Refreshing library from Apple Music…");
	AppAssistant.startLibrarySync(function (err) {
		self.controller.get("refreshBtn").mojo.deactivate();
		if (err) {
			self.setStatus("Refresh failed: " + ((err && err.message) || "unknown"));
		} else {
			self.setStatus("Library refreshed");
			Mojo.Controller.getAppController().showBanner("Library refreshed", {});
		}
	});
};

PreferencesAssistant.prototype.onClearCache = function () {
	var self = this;
	this.setStatus("Clearing cache…");
	Jukie.playback.clearCache(function (response) {
		if (response && response.returnValue !== false) {
			var freed = response.freedBytes ? (" (" + Math.round(response.freedBytes / 1048576) + " MB)") : "";
			self.setStatus("Cache cleared" + freed + " - songs saved offline were kept");
			self.refreshCacheUsage();
			Jukie.refreshOffline();
		} else {
			self.setStatus("Clear cache failed");
		}
	});
};

PreferencesAssistant.prototype.cleanup = function () {
	this.broker.stop();
	this.controller.get("signInBtn").stopObserving(Mojo.Event.tap, this.signInH);
	this.controller.get("signInCancelBtn").stopObserving(Mojo.Event.tap, this.signInCancelH);
	this.controller.get("saveBtn").stopObserving(Mojo.Event.tap, this.saveH);
	this.controller.get("refreshBtn").stopObserving(Mojo.Event.tap, this.refreshH);
	this.controller.get("clearCacheBtn").stopObserving(Mojo.Event.tap, this.clearH);
};
