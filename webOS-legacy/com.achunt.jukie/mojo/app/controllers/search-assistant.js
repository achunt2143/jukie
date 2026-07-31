/*globals Mojo, Jukie */
/*
 * SearchAssistant - Apple Music catalog search. Type a term, tap Search (or hit enter),
 * get results for whichever type is selected (Song/Album/Artist, via the header picker),
 * tap a result to act on it. Uses AppleMusicService.searchCatalog + mapSearchResults.
 *
 * The type picker mirrors Palm's own Calendar app's header calendar-source picker: a
 * plain custom div in the palm-header with a tap listener, opened via the standalone
 * Sub-menu API (controller.popupSubmenu({items, placeNear, toggleCmd, onChoose})) - not
 * Mojo.Menu.viewMenu, which is a different, framework-menu-scoped mechanism. Reference
 * implementation: com.ahunt.synergystopwatch.veer's main-assistant.js modeTapHandler.
 */
var SearchAssistant = function () {
	this._results = [];
};

// type -> {label shown in the header pill, plural API type, row mapper key}
SearchAssistant.prototype.TYPES = {
	songs:   { label: "Song",   apiType: "songs" },
	albums:  { label: "Album",  apiType: "albums" },
	artists: { label: "Artist", apiType: "artists" }
};
// Order the picker offers them in, per the user's own ordering (Artist, Song, Album).
SearchAssistant.prototype.TYPE_ORDER = ["artists", "songs", "albums"];

SearchAssistant.prototype.setup = function () {
	this.searchType = "songs";

	this.fieldModel = { value: "" };
	this.controller.setupWidget("searchField", {
		hintText: "Search the catalog", multiline: false, textFieldName: "q",
		enterSubmits: true, changeOnKeyPress: false, autoFocus: true, autoReplace: false
	}, this.fieldModel);

	this.btnModel = { label: "Search", disabled: false };
	this.controller.setupWidget("searchBtn", { type: Mojo.Widget.activityButton }, this.btnModel);

	// See the note in list-assistant.js: this framework build's List widget always
	// needs attributes.dataSource (model.items alone isn't enough), so wrap our
	// results array in the framework's own fixed-array assistant.
	this.listAssistant = new Mojo.DataSource.LocalDataSourceAssistant([], { uniquenessProperty: "_idx" });
	this.listModel = { items: [] };
	this.controller.setupWidget("scenelist", {
		templates: { item: "list/media-row" },
		dataSource: new Mojo.DataSource(this.listAssistant),
		swipeToDelete: false,
		reorderable: false
	}, this.listModel);

	this.updateTypeLabel();

	this.submitH = this.doSearch.bind(this);
	this.tapH = this.onTapBtn.bind(this);
	this.listTapH = this.onListTap.bindAsEventListener(this);
	this.typeTapH = this.onTypeTap.bindAsEventListener(this);
	this.controller.get("searchField").observe(Mojo.Event.propertyChange, this.enterH = this.onFieldChange.bind(this));
	this.controller.listen("searchField", Mojo.Event.enterKeyPress, this.submitH);
	this.controller.get("searchBtn").observe(Mojo.Event.tap, this.tapH);
	this.controller.get("scenelist").observe(Mojo.Event.listTap, this.listTapH);
	this.controller.listen("search-type-source", Mojo.Event.tap, this.typeTapH);
};

SearchAssistant.prototype.updateTypeLabel = function () {
	var el = this.controller.get("search-type-label");
	if (el) { el.update(this.TYPES[this.searchType].label); }
};

SearchAssistant.prototype.onTypeTap = function () {
	var self = this;
	var pillEl = this.controller.get("search-type-source");
	var items = this.TYPE_ORDER.map(function (t) {
		return { label: self.TYPES[t].label, command: t };
	});
	try {
		this.controller.popupSubmenu({
			items: items,
			placeNear: pillEl,
			toggleCmd: this.searchType,
			onChoose: this.typeChosen.bind(this)
		});
	} catch (e) {
		Mojo.Log.error("[Search] popupSubmenu failed: " + e);
	}
};

// onChoose receives the command string directly, undefined if dismissed without a pick.
SearchAssistant.prototype.typeChosen = function (type) {
	if (!type || type === this.searchType) { return; }
	this.searchType = type;
	this.updateTypeLabel();
	// Re-run in place if there's already a term, so switching type re-filters what's on
	// screen instead of leaving stale results from the old type up.
	if ((this.fieldModel.value || "").replace(/^\s+|\s+$/g, "")) { this.doSearch(); }
};

SearchAssistant.prototype.onFieldChange = function () { /* value tracked in model */ };
SearchAssistant.prototype.onTapBtn = function () { this.doSearch(); };

SearchAssistant.prototype.doSearch = function () {
	var self = this;
	var term = (this.fieldModel.value || "").replace(/^\s+|\s+$/g, "");
	if (!term) { return; }
	var type = this.searchType;
	var limit = (Jukie.prefs && Jukie.prefs.searchResultLimit) || 5;
	this.setStatus("Searching…");
	Jukie.apple.searchCatalog(term, limit, [this.TYPES[type].apiType]).then(function (resp) {
		if (type !== self.searchType) { return; } // type changed again while this was in flight
		var mapped = Jukie.apple.mapSearchResults(resp);
		self._results = mapped[self.TYPES[type].apiType] || [];
		self._resultType = type;
		var rows = self._results.map(function (r, i) {
			return {
				// Mojo's #{...} substitution escapes for us; escaping here double-encodes.
				primary: (type === "artists" ? r.name : r.title) || "",
				secondary: type === "songs" ? (r.artist || "") : (type === "albums" ? (r.artist || "") : ""),
				thumb: Jukie.artUrl(r.artUrl, 80),
				_idx: i
			};
		});
		self.listAssistant.originalItemsArray = self.listAssistant.itemsArray = rows;
		self.controller.get("scenelist").mojo.invalidate();
		self.setStatus(self._results.length ? "" : "No results.");
		var btn = self.controller.get("searchBtn");
		if (btn && btn.mojo) { btn.mojo.deactivate(); }
	}).catch(function (err) {
		Mojo.Log.error("[Search] failed: " + err);
		self.setStatus("Search failed. Check your Developer Token in Preferences.");
		var btn = self.controller.get("searchBtn");
		if (btn && btn.mojo) { btn.mojo.deactivate(); }
	});
};

SearchAssistant.prototype.setStatus = function (t) {
	var el = this.controller.get("list-status");
	if (el) { el.innerHTML = t || ""; }
};

SearchAssistant.prototype.onListTap = function (event) {
	var item = event.item;
	if (!item || typeof item._idx !== "number") { return; }
	var r = this._results[item._idx];
	if (!r || !r.id) { return; }

	if (this._resultType === "songs") {
		// The whole result set becomes the queue, so prev/next work through search hits too.
		var queue = this._results.map(function (s) {
			return { catalogId: s.id, libraryId: "", title: s.title, artist: s.artist, album: s.album, artUrl: s.artUrl, durationMs: s.durationInMillis || 0 };
		});
		Jukie.setQueue(queue, item._idx);
		Jukie.playAt(item._idx, 1);
		this.controller.stageController.pushScene("nowplaying");
		return;
	}

	if (this._resultType === "albums") {
		// SongsAssistant already knows how to fetch a catalog album's tracks by id.
		this.controller.stageController.pushScene("songs", { albumId: r.id, title: r.title });
		return;
	}

	if (this._resultType === "artists") {
		// No dedicated artist-detail scene exists (an artist's catalog "top songs" isn't a
		// single API call the way an album's tracks are), so the practical equivalent of
		// "show me this artist" is: search their name as a Song search instead.
		this.searchType = "songs";
		this.updateTypeLabel();
		this.fieldModel.value = r.name;
		this.controller.modelChanged(this.fieldModel);
		this.doSearch();
	}
};

SearchAssistant.prototype.cleanup = function () {
	this.controller.stopListening("searchField", Mojo.Event.enterKeyPress, this.submitH);
	this.controller.get("searchField").stopObserving(Mojo.Event.propertyChange, this.enterH);
	this.controller.get("searchBtn").stopObserving(Mojo.Event.tap, this.tapH);
	this.controller.get("scenelist").stopObserving(Mojo.Event.listTap, this.listTapH);
	this.controller.stopListening("search-type-source", Mojo.Event.tap, this.typeTapH);
};
