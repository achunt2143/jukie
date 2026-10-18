/*globals Mojo, Jukie */
/*
 * JukieListAssistant - shared base for the library browse lists (Songs/Albums/Artists/
 * Playlists) and the arg-driven track lists (an album's / artist's / playlist's songs).
 * Mirrors the inheritance shape of Palm's sample ListAssistant, but feeds a Mojo List
 * widget from a fixed in-memory model loaded out of the db8 library cache (or the Apple
 * catalog) instead of a live local-media db8 DataSource.
 *
 * Subclasses override: title, emptyText, fetchRows() -> Promise<array>, toRow(rec) ->
 * {primary, secondary, thumb}, and handleTap(rec). Each row model object also carries a
 * hidden `_rec` back-reference to the source record so handleTap gets the original.
 *
 * Header search icon: a live, client-side filter over whatever's already loaded in
 * `_records` (the locally cached library, already fetched from db8 - NOT a new network
 * call), matching the primary/secondary text of each row. Tapping the icon reveals a
 * TextField in place of the header title; typing filters on every keystroke.
 *
 * NOTE: a FilterList-based rewrite was tried here and reverted - it left the list stuck
 * on "Loading..." on-device after two attempted fixes, and this build's exact
 * filterFunction/setupWidget timing contract couldn't be confirmed without live device
 * debugging. Back to the known-working plain List + hand-rolled filter bar below.
 */
var JukieListAssistant = function () {};

JukieListAssistant.prototype = {

	title: "List",
	emptyText: "Nothing here yet.",
	itemTemplate: "list/media-row",
	// Override with {labelCallback, template} to group rows under headers - Mojo's List
	// widget has this built in (confirmed against Palm's own real Music Player app,
	// dev-stuff/.../app/controllers/songs-assistant.js): it watches labelCallback's return
	// value as it walks the (already-loaded) rows in order and inserts a `template` row
	// whenever that value changes. Rows MUST already be sorted by whatever key the
	// callback groups on - this does not itself sort or bucket anything, just detects
	// changes between consecutive rows.
	dividers: null,

	// Turn an Apple artwork URL template ({w}x{h}) into a real thumbnail URL.
	// Jukie.artUrl also forces http - see the note there; https to Apple hosts
	// cannot complete a handshake on this device, so https artwork never loads.
	thumbUrl: function (url, px) {
		return Jukie.artUrl(url, px || 80);
	},

	setup: function () {
		this.controller.get("list-title").update((this.title || "").escapeHTML());
		Jukie.setupBack(this.controller);

		// This device's List widget (palmInitFramework2112, an older/differently-built
		// "mojo" than the SDK's docs/samples describe - see javascripts/list in
		// mojo2/submissions for the version the SDK ships) is virtualized: its
		// _ChainManager always requires attributes.dataSource and throws "Failed to
		// specify a datasource when setting up the list" if it's missing - passing
		// model.items alone (the SDK-documented "fixed list" shape) is NOT enough on
		// this build. Mojo.DataSource.LocalDataSourceAssistant is this framework's own
		// built-in fixed-array assistant (confirmed by reading
		// palmInitFramework2112.js directly on-device); wrap our rows array in it.
		this.listAssistant = new Mojo.DataSource.LocalDataSourceAssistant([], { uniquenessProperty: "_idx" });
		this.listModel = { items: [] };
		var widgetAttrs = {
			templates: { item: this.itemTemplate },
			dataSource: new Mojo.DataSource(this.listAssistant),
			swipeToDelete: !!this.swipeToDelete,
			// Swipe leaves a Delete / Undo pair instead of deleting at once - removing a saved
			// song throws its audio away, so an accidental swipe should be recoverable.
			autoconfirmDelete: false,
			reorderable: false
		};
		if (this.dividers) { widgetAttrs.dividers = this.dividers; }
		this.controller.setupWidget("scenelist", widgetAttrs, this.listModel);

		this.tapHandler = this.onListTap.bindAsEventListener(this);
		this.controller.get("scenelist").observe(Mojo.Event.listTap, this.tapHandler);
		if (this.swipeToDelete) {
			this.deleteHandler = this.onListDelete.bindAsEventListener(this);
			this.controller.get("scenelist").observe(Mojo.Event.listDelete, this.deleteHandler);
		}
		this.holdHandler = this.onListHold.bindAsEventListener(this);
		this.controller.get("scenelist").observe(Mojo.Event.hold, this.holdHandler);
		// Rows that show offline state (usesOfflineState) repaint when it changes.
		this.offlineWatcher = this.onOfflineChanged.bind(this);
		Jukie.watchOffline(this.offlineWatcher);

		this._filterText = "";
		this.filterModel = { value: "" };
		this.controller.setupWidget("list-filter-field", {
			hintText: "Search " + (this.title || "this list"), multiline: false,
			changeOnKeyPress: true, autoFocus: false, autoReplace: false
		}, this.filterModel);
		this.filterChangeHandler = this.onFilterChange.bindAsEventListener(this);
		this.controller.get("list-filter-field").observe(Mojo.Event.propertyChange, this.filterChangeHandler);
		this.searchBtnHandler = this.toggleFilter.bindAsEventListener(this);
		this.controller.listen("list-search-btn", Mojo.Event.tap, this.searchBtnHandler);

		this.load();
	},

	// Reveal/hide the filter TextField in place of the title. Hiding always clears the
	// filter (matches the search bar's own affordance elsewhere: closing it resets).
	toggleFilter: function () {
		this._filterVisible = !this._filterVisible;
		var bar = this.controller.get("list-filter-bar");
		var status = this.controller.get("list-status");
		if (this._filterVisible) {
			bar.style.display = "";
			status.style.marginTop = "0";
			var field = this.controller.get("list-filter-field");
			if (field && field.mojo && field.mojo.focus) { field.mojo.focus(); }
		} else {
			bar.style.display = "none";
			status.style.marginTop = "52px";
			this.filterModel.value = "";
			this.controller.modelChanged(this.filterModel);
			this._filterText = "";
			this.applyFilter("");
		}
	},

	onFilterChange: function () {
		this._filterText = this.filterModel.value || "";
		this.applyFilter(this._filterText);
	},

	load: function () {
		var self = this;
		this.setStatus("Loading…");
		this.fetchRows().then(function (records) {
			self._records = records || [];
			self.applyFilter(self._filterText);
		}).catch(function (err) {
			Mojo.Log.error("[JukieList] load failed: " + err);
			self.setStatus(Jukie.online ? "Couldn't load this list." : "You're offline. This list needs an internet connection.");
		});
	},

	// Rebuilds the list's rows from _records (the full, already-fetched dataset),
	// keeping only rows matching `query` against their own displayed text. _idx on each
	// row always points back into the FULL _records array (not the filtered subset's own
	// position), so tapping a filtered result still resolves to the right record.
	applyFilter: function (query) {
		var self = this;
		var records = this._records || [];
		var needle = (query || "").toLowerCase();
		var rows = [];
		records.forEach(function (rec, i) {
			var row = self.toRow(rec);
			if (needle) {
				var hay = ((row.primary || "") + " " + (row.secondary || "")).toLowerCase();
				if (hay.indexOf(needle) === -1) { return; }
			}
			row._idx = i;
			rows.push(row);
		});
		this.listAssistant.originalItemsArray = this.listAssistant.itemsArray = rows;
		// invalidate() (the one method this widget exposes for this) tells the
		// chain manager to drop its cached links and re-fetch from the dataSource,
		// which now sees the new itemsArray.
		this.controller.get("scenelist").mojo.invalidate();
		this.setStatus(rows.length ? "" : (needle ? "No matches." : this.emptyText));
	},

	setStatus: function (text) {
		var el = this.controller.get("list-status");
		if (el) { el.innerHTML = text || ""; }
	},

	onListTap: function (event) {
		if (this._holdAt && Date.now() - this._holdAt < 700) { return; }
		var item = event.item;
		if (!item || typeof item._idx !== "number") { return; }
		var rec = this._records[item._idx];
		// Pass the index through as well: track lists use it to seed the play queue so
		// Now Playing's prev/next can move through the list that was actually tapped.
		if (rec) { this.handleTap(rec, item._idx); }
	},

	// Swipe-to-delete (scenes that set swipeToDelete = true and define deleteRecord(rec)):
	// the framework has already slid the row away and the user confirmed with Delete. The
	// rows come from our own data source, not the widget's model, so we do the removal
	// ourselves - preventDefault() stops the widget editing its (empty) model.items - and
	// drop the record locally first so the repaint that follows doesn't bring the row back.
	onListDelete: function (event) {
		event.preventDefault();
		var item = event.item;
		var idx = item && item._idx;
		var rec = typeof idx === "number" && this._records && this._records[idx];
		if (!rec) { return; }
		this._records.splice(idx, 1);
		this.deleteRecord(rec);
	},

	// Tap-and-hold on a row: a scene that defines holdActionsFor(rec) -> [{label, command}]
	// gets a popup menu of those actions; onHoldChoice(command, rec) runs the pick.
	onListHold: function (event) {
		if (!this.holdActionsFor) { return; }
		// Find the pressed row from the DOM: each row carries its record index in data-idx
		// (media-row.html). The list widget's own getItemByNode doesn't exist in the older
		// framework build Lunacy ships (palmInitFramework2205).
		// Plain DOM walk rather than Prototype's up(): the framework element helpers behaved
		// differently across builds, and this only needs className + getAttribute.
		var rowEl = event.target, chain = [];
		while (rowEl && rowEl.nodeType === 1) {
			chain.push(rowEl.className || rowEl.tagName);
			if ((" " + rowEl.className + " ").indexOf(" jukie-row ") !== -1) { break; }
			rowEl = rowEl.parentNode;
		}
		if (!rowEl || rowEl.nodeType !== 1) { rowEl = null; }
		var idx = rowEl ? parseInt(rowEl.getAttribute("data-idx"), 10) : NaN;
		if (isNaN(idx)) {
			Mojo.Log.error("[JukieList] hold: no list row found above " + chain.join(" < "));
			return;
		}
		var rec = (this._records || [])[idx];
		var actions = rec && this.holdActionsFor(rec);
		if (!actions || !actions.length) { return; }
		event.stop();
		// Letting go after a hold can still arrive as a tap; don't let that start playback.
		this._holdAt = Date.now();
		var self = this;
		try {
			this.controller.popupSubmenu({
				items: actions,
				placeNear: event.target,
				onChoose: function (command) { if (command) { self.onHoldChoice(command, rec); } }
			});
		} catch (e) {
			Mojo.Log.error("[JukieList] popupSubmenu failed: " + e);
		}
	},

	onOfflineChanged: function () {
		if (this.usesOfflineState && this._records) { this.applyFilter(this._filterText); }
	},

	cleanup: function () {
		Jukie.unwatchOffline(this.offlineWatcher);
		if (this.deleteHandler) {
			this.controller.get("scenelist").stopObserving(Mojo.Event.listDelete, this.deleteHandler);
		}
		this.controller.get("scenelist").stopObserving(Mojo.Event.hold, this.holdHandler);
		this.controller.get("scenelist").stopObserving(Mojo.Event.listTap, this.tapHandler);
		this.controller.get("list-filter-field").stopObserving(Mojo.Event.propertyChange, this.filterChangeHandler);
		this.controller.stopListening("list-search-btn", Mojo.Event.tap, this.searchBtnHandler);
	},

	// ---- overridable ----
	fetchRows: function () { return Promise.resolve([]); },
	toRow: function (rec) { return { primary: "", secondary: "", thumb: "" }; },
	handleTap: function (rec) { },
	deleteRecord: function (rec) { },

	// A-Z group key for a row's display text - mirrors Palm's own Music Player app's
	// Util.getAlphaGroup: first letter uppercased, digits collapse to a single "#" group.
	alphaGroupOf: function (text) {
		var ch = (text || "").charAt(0).toUpperCase();
		if (ch >= "0" && ch <= "9") { ch = "#"; }
		return ch || "#";
	}
};
