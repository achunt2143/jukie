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

PreferencesAssistant.prototype.setup = function () {
	var prefs = Jukie.prefs || Jukie.settings.defaults();

	this.devModel = { value: prefs.developerToken || "" };
	this.musicModel = { value: prefs.musicUserToken || "" };
	this.storeModel = { value: prefs.storefront || "us" };
	this.cacheModel = { value: prefs.cacheEnabled !== false };
	this.searchLimitModel = { value: prefs.searchResultLimit || 5 };

	this.controller.setupWidget("devToken", {
		hintText: "paste Developer Token", multiline: true, textFieldName: "devToken",
		changeOnKeyPress: true, autoFocus: false, autoReplace: false, autoCapitalization: false
	}, this.devModel);

	this.controller.setupWidget("musicToken", {
		hintText: "paste Music User Token", multiline: true, textFieldName: "musicToken",
		changeOnKeyPress: true, autoFocus: false, autoReplace: false, autoCapitalization: false
	}, this.musicModel);

	// No `label` attribute here (the framework renders that as small text next
	// to the value, not as a caption) - the field-label div above already says
	// "Storefront", so this just shows the selected value with its dropdown.
	this.controller.setupWidget("storefront", {
		choices: this.STOREFRONTS, modelProperty: "value"
	}, this.storeModel);

	this.controller.setupWidget("cacheToggle", { modelProperty: "value" }, this.cacheModel);

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

PreferencesAssistant.prototype.onSave = function () {
	var self = this;
	var rec = {
		developerToken: (this.devModel.value || "").replace(/\s+/g, ""),
		musicUserToken: (this.musicModel.value || "").replace(/\s+/g, ""),
		storefront: this.storeModel.value || "us",
		cacheEnabled: this.cacheModel.value !== false,
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
			self.setStatus("Cache cleared" + freed);
		} else {
			self.setStatus("Clear cache failed");
		}
	});
};

PreferencesAssistant.prototype.cleanup = function () {
	this.controller.get("saveBtn").stopObserving(Mojo.Event.tap, this.saveH);
	this.controller.get("refreshBtn").stopObserving(Mojo.Event.tap, this.refreshH);
	this.controller.get("clearCacheBtn").stopObserving(Mojo.Event.tap, this.clearH);
};
