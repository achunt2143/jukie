/*globals enyo, $L, event, Utilities, window */
enyo.kind({
	name: "kindListViewGenres",
	kind: "listViewDraggable",
	published: {boolViewActive: false, intColumns: 4},
	events: {onSetPlaybackList: "", onRequestMedia: "", onListChanged: "", onListSorted: "", onSelectGenre: "", onRequestPlaylists: "", onShowBanner: ""},
	height: "100%",
	components: [
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchGenres"},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "listMedia", kind: "VirtualList", onSetupRow: "listSetupRow", flex: 1, height: "100%", components: [
				{name: "itemRow", style: "background:#F7F7F7;", kind: "Control", layoutKind: "HFlexLayout"}
			]}
		]},
		{name: "empty", kind: "Control", layoutKind: "VFlexLayout", align: "center", height: "100%", pack: "justify", className: "empty", showing: false, components: [
			{kind: "Spacer", flex: 1},
			{kind: "Control", className: "content", components: [
				{kind: "Image", src: "images/bg_empty_genres.png"},
				{content: $L("There are no genres available."), className: "heading"},
				{content: $L("Search Apple Music or populate normalized genre results to fill this view.")}
			]},
			{kind: "Button", caption: $L("Add songs"), showing: false},
			{kind: "Spacer", flex: 3}
		]},
		{name: "loading", kind: "Control", layoutKind: "VFlexLayout", align: "center", flex: 1, height: "100%", pack: "center", className: "empty", showing: false, components: [
			{kind: "SpinnerLarge", showing: true}
		]}
	],

	intCurrTrack: -1,
	intCurrTrackOrigIndex: -1,
	strCurrListID: "",
	strSortMode: "name",
	boolSortAsc: true,
	boolNotifyListChange: false,
	boolNeedRendered: true,
	searchQuery: "",
	arGenres: [],

	create: function () {
		try {
			this.inherited(arguments);
			this.strSortMode = "name";
			this.boolSortAsc = true;
			this.strCurrListID = Utilities.generateGuid();
		} catch (err) {
			this.log("**** create error: " + err);
		}
		this.local_tracks_Templ = new enyo.g11n.Template($L("#{num} songs"));
		this.local_track_Templ = new enyo.g11n.Template($L("#{num} song"));
	},

	ready: function () {
		try {
			this.$.ctrlListViewHeader.setStrHeaderTitle($L("Genres"));
		} catch (err) {
			this.log("**** musiclibrary ready error: " + err);
		}
	},

	rendered: function () {
		this.inherited(arguments);
	},

	_normalizeGenre: function (objGenre) {
		var normalized = objGenre || {};
		normalized.id = normalized.id || "";
		normalized.name = normalized.name || normalized.genre || "";
		normalized.trackCount = normalized.trackCount || (normalized.total && normalized.total.tracks) || 0;
		normalized.artUrl = normalized.artUrl || "";
		return normalized;
	},

	renderList: function () {
		this.$.ctrlListViewHeader.clearSearchInput(false);
		this.searchQuery = "";
		this.buildCells();
		this.listQuery();
	},

	refreshList: function () {
		this.$.ctrlListViewHeader.clearSearchInput(false);
		if (this.boolNeedRendered) {
			this.renderList();
		}
	},

	resizeList: function () {
		this.log();
		this.$.listMedia.resized();
	},

	listQuery: function () {
		var objGetMediaRequest = {where: [], mediaType: "genre", order: this.strSortMode, callback: enyo.bind(this, "gotGenres")};
		this.log();
		if (this.searchQuery) {
			objGetMediaRequest.queryType = "search";
			objGetMediaRequest.where = [{prop: "name", op: "%", val: this.searchQuery, collate: "primary"}];
		}
		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetMediaRequest);
		this.doRequestMedia(objGetMediaRequest);
	},

	gotGenres: function (inResponse, inRequest) {
		var objGetMediaRequest;
		var results;
		this.log();
		try {
			this.log("**** gotGenres");
			results = (inResponse && inResponse.results) ? inResponse.results : [];
			this.log("count: " + results.length);
			objGetMediaRequest = inRequest.objGetMediaRequest || {};
			this.arGenres = results.map(enyo.bind(this, function (genre) {
				return this._normalizeGenre(genre);
			}));
			if (this.arGenres.length > 0) {
				this.log("--: " + this.arGenres[0].name);
			}
			this.boolNeedRendered = !!(objGetMediaRequest.queryType === "search" && objGetMediaRequest.where && objGetMediaRequest.where[0] && objGetMediaRequest.where[0].val.length > 0);
			this.$.ctrlListViewHeader.setIntHeaderCount(this.arGenres.length);
			if (this.arGenres.length > 0) {
				this.$.content.show();
				this.$.listMedia.resized();
				this.$.listMedia.punt();
				this.$.empty.hide();
			} else {
				this.$.content.hide();
				this.$.listMedia.punt();
				if (objGetMediaRequest.queryType === "search") {
					this.$.empty.hide();
				} else {
					this.$.empty.show();
				}
			}
			this.boolListRendered = true;
		} catch (err) {
			this.log("**** gotGenres error: " + err);
		}
	},

	onSearchGenres: function (sender, strSearch) {
		this.log(strSearch);
		this.arGenres = [];
		this.searchQuery = Utilities.fastTrim(strSearch);
		this.listQuery();
		return true;
	},

	intColumnsChanged: function (oldVal) {
		if (this.intColumns === oldVal) {
			return;
		}
		this.log(this.boolViewActive);
		if (this.boolViewActive) {
			this.buildCells();
			this.listQuery();
		} else {
			this.boolNeedRendered = true;
		}
	},

	buildCells: function () {
		var i;
		var ctrlItemGenre;
		this.$.itemRow.destroyControls();
		this.cells = [];
		for (i = 0; i < this.intColumns; i++) {
			ctrlItemGenre = this.$.itemRow.createComponent({kind: "draggableGenre", onclick: "onclick_listMedia", intColumnIndex: i});
			this.cells.push(ctrlItemGenre);
		}
		this.$.itemRow.render();
	},

	listSetupRow: function (sender, intIndex) {
		var intGenreIndex = intIndex * this.intColumns;
		var i;
		var itemGenre;
		var objGenre;
		var trackCount;
		try {
			this.log(intIndex);
			if (intGenreIndex >= 0 && intGenreIndex < this.arGenres.length) {
				for (i = 0; i < this.intColumns; i++) {
					this.log("intGenreIndex: " + intGenreIndex);
					itemGenre = this.cells[i];
					if (this.arGenres !== undefined && this.arGenres[intGenreIndex] !== undefined) {
						objGenre = this.arGenres[intGenreIndex];
						this.log(objGenre.name);
						itemGenre.setStrItemText(objGenre.name);
						trackCount = objGenre.trackCount || 0;
						itemGenre.setStrItemSubText(trackCount !== 1 ? this.local_tracks_Templ.evaluate({num: trackCount}) : this.local_track_Templ.evaluate({num: trackCount}));
						itemGenre.setIntThumbCount(trackCount);
						itemGenre.setStrImageURL(objGenre.artUrl || "");
						itemGenre.setBoolLandscape(this.intColumns === 4);
						itemGenre.show();
					} else {
						itemGenre.hide();
					}
					intGenreIndex++;
				}
				return true;
			}
			return false;
		} catch (err) {
			this.log("error: " + err);
			return false;
		}
	},

	onclick_listMedia: function (sender) {
		var intClickIndex;
		var objClickedGenre;
		this.log();
		if (!this.boolSuspendClick) {
			intClickIndex = (this.$.listMedia.fetchRowIndex() * this.intColumns) + sender.intColumnIndex;
			this.log("intClickIndex: " + intClickIndex);
			objClickedGenre = this.arGenres[intClickIndex];
			this.doSelectGenre(objClickedGenre);
		} else {
			this.boolSuspendClick = false;
		}
	},

	setItemHighlighted: function () {
	}
});