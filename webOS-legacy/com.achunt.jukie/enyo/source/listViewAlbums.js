/*globals enyo, $L, event, Utilities, window */
enyo.kind({
	name: "kindListViewAlbums",
	kind: "listViewDraggable",
	published: {boolViewActive: false},
	className: "artists",
	events: {onSetPlaybackList: "", onRequestMedia: "", onListChanged: "", onListSorted: "", onSelectAlbum: "", onRequestPlaylists: ""},
	height: "100%",
	components: [
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchAlbums"},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{kind: "Control", layoutKind: "HFlexLayout", flex: 1, components: [
				{name: "listMedia", kind: "VirtualList", onQuery: "listQuery", onSetupRow: "listSetupRow", className: "listMedia", flex: 1, components: [
					{name: "header", kind: "Control", className: "divider", style: "margin-top: -1px;", components: [{name: "divider", kind: "Control", className: "column"}]},
					{name: "itemMedia", kind: "draggableAlbumGroup", className: "album", layoutKind: "HFlexLayout", align: "center", onclick: "onclick_listMedia", components: [
						{className: "column play", onclick: "onclick_playAlbum", components: [
							{name: "imgPLay", kind: "ToolButton", icon: "images/bg_item_play.png"}
						]},
						{name: "covers", className: "column cover", components: [{name: "imgContainer", className: "img", showing: false, components: [{name: "imgThumb", kind: "Image", onerror: "onError_imgThumb"}]}]},
						{kind: "Control", components: [
							{kind: "Control", layoutKind: "HFlexLayout", components: [
								{name: "albumName", className: "column name", content: ""},
								{name: "albumCounts", className: "column count", content: ""}
							]},
							{name: "albumArtist", className: "column", content: ""}
						]}
					]}
				]},
				{name: "alphaPicker", kind: "AlphaPicker", onAlphaPicked: "onAlphaPicked_AlphaPicker"}
			]}
		]},
		{name: "empty", kind: "Control", layoutKind: "VFlexLayout", align: "center", height: "100%", pack: "justify", className: "empty", showing: false, components: [
			{kind: "Spacer", flex: 1},
			{kind: "Control", className: "content", components: [
				{kind: "Image", src: "images/bg_empty_albums.png"},
				{content: $L("There are no albums available."), className: "heading"},
				{content: $L("Search Apple Music or add library-backed album browsing to populate this view.")}
			]},
			{kind: "Button", caption: $L("Add songs"), showing: false},
			{kind: "Spacer", flex: 3}
		]},
		{name: "loading", kind: "Control", layoutKind: "VFlexLayout", align: "center", flex: 1, height: "100%", pack: "center", className: "empty", showing: false, components: [
			{kind: "SpinnerLarge", showing: true}
		]},
		{name: "txtResults"}
	],

	intCurrTrack: -1,
	intCurrTrackOrigIndex: -1,
	strCurrListID: "",
	strSortMode: "name",
	boolSortAsc: true,
	boolNotifyListChange: false,
	boolDragHold: false,
	boolDragItem: false,
	boolDraggingList: false,
	boolNeedRendered: true,
	arAlbums: [],
	objAlphaJumps: {},
	searchQuery: "",

	create: function () {
		try {
			this.inherited(arguments);
			this.strSortMode = "name";
			this.boolSortAsc = true;
			this.strCurrListID = Utilities.generateGuid();
		} catch (err) {
			this.log("**** create error: " + err);
		}
		this.local_tracks_Templ = new enyo.g11n.Template($L("(#{num} songs)"));
		this.local_track_Templ = new enyo.g11n.Template($L("(#{num} song)"));
	},

	ready: function () {
		try {
			this.inherited(arguments);
			this.$.ctrlListViewHeader.setStrHeaderTitle($L("Albums"));
		} catch (err) {
			this.log("**** musiclibrary ready error: " + err);
		}
	},

	rendered: function () {
		this.inherited(arguments);
	},

	_normalizeAlbum: function (objAlbum) {
		var normalized = objAlbum || {};
		normalized.id = normalized.id || "";
		normalized.name = normalized.name || normalized.title || "";
		normalized.artist = normalized.artist || normalized.artistName || "";
		normalized.artUrl = normalized.artUrl || "";
		normalized.trackCount = normalized.trackCount || (normalized.total && normalized.total.tracks) || 0;
		return normalized;
	},

	renderList: function () {
		this.$.ctrlListViewHeader.clearSearchInput(false);
		this.searchQuery = "";
		this.listQuery();
	},

	resizeList: function () {
		this.log();
		this.$.listMedia.resized();
	},

	refreshList: function () {
		this.$.ctrlListViewHeader.clearSearchInput(false);
		if (this.boolNeedRendered) {
			this.renderList();
		}
	},

	listQuery: function () {
		var objGetMediaRequest = {where: [], mediaType: "album", order: this.strSortMode, callback: enyo.bind(this, "gotAlbums")};
		this.log();
		if (this.searchQuery) {
			objGetMediaRequest.queryType = "search";
			objGetMediaRequest.where = [{prop: "name", op: "%", val: this.searchQuery, collate: "primary"}];
		}
		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetMediaRequest);
		this.doRequestMedia(objGetMediaRequest);
	},

	gotAlbums: function (inResponse, inRequest) {
		var objGetMediaRequest;
		var results;
		this.log();
		try {
			this.log("**** gotAlbums");
			results = (inResponse && inResponse.results) ? inResponse.results : [];
			this.log("count: " + results.length);
			objGetMediaRequest = inRequest.objGetMediaRequest || {};
			this.arAlbums = results.map(enyo.bind(this, function (album) {
				return this._normalizeAlbum(album);
			}));
			this.boolNeedRendered = !!(objGetMediaRequest.queryType === "search" && objGetMediaRequest.where && objGetMediaRequest.where[0] && objGetMediaRequest.where[0].val.length > 0);
			this.$.ctrlListViewHeader.setIntHeaderCount(this.arAlbums.length);
			if (this.arAlbums.length > 0) {
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
			this._buildAlphaJumps();
			this.boolListRendered = true;
		} catch (err) {
			this.log("**** gotAlbums error: " + err);
		}
	},

	// A-Z fast-scroll: mark which letters have at least one album so AlphaPicker can gray
	// out the rest, then jump the list when a letter is tapped/dragged over.
	//
	// getBaseLabelChar loads a g11n Unicode character-data file with no persistent cache -
	// genuinely expensive per call. Precompute it ONCE here per album as _alphaLabel so
	// listSetupRow (runs on every row recycle during scrolling, not just once per list load)
	// and onAlphaPicked_AlphaPicker just read the stored value instead of recalculating it
	// live - recalculating per-row on a big list is what caused a real scroll/performance
	// regression on the (much larger) Songs list; same fix applied here defensively.
	_buildAlphaJumps: function () {
		var jumps = {}, i, label;
		for (i = 0; i < this.arAlbums.length; i++) {
			label = Utilities.getBaseLabelChar(this.arAlbums[i].name);
			this.arAlbums[i]._alphaLabel = label;
			jumps[label] = true;
		}
		this.objAlphaJumps = jumps;
		if (this.$.alphaPicker) {
			this.$.alphaPicker.populate(jumps);
		}
	},

	onAlphaPicked_AlphaPicker: function (sender, chrAlpha) {
		var i;
		for (i = 0; i < this.arAlbums.length; i++) {
			if (this.arAlbums[i]._alphaLabel === chrAlpha) {
				this._jumpListTo(i);
				return;
			}
		}
	},

	// See listViewArtists.js for the full explanation. Walking there via setScrollPosition
	// (whether one call or chunked hops) still renders every intervening row - fine for a
	// short flick, but for a big jump that's just as slow overall even when chunked, only
	// spread out into a multi-second "crawl" instead of an instant jump. The actual fix:
	// reset the SAME internal pointers punt() already resets on every list refresh, but
	// anchored at the TARGET row instead of hardcoded 0 - updatePages() then only renders
	// enough rows to fill the viewport, a real O(viewport) jump regardless of distance.
	_jumpListTo: function (rowIndex) {
		var scroller = this.$.listMedia && this.$.listMedia.$.scroller;
		if (!scroller || !scroller.$.scroll || !scroller.domBuffer || !scroller.displayBuffer) {
			return;
		}
		var top = Math.max(0, rowIndex);
		scroller.$.scroll.stop();
		scroller.top = top;
		scroller.bottom = top - 1;
		scroller.domBuffer.flush();
		scroller.displayBuffer.bottom = scroller.domBuffer.bottom = scroller.bottom;
		scroller.displayBuffer.top = scroller.domBuffer.top = scroller.top;
		scroller.contentHeight = 0;
		scroller.displayBuffer.height = 0;
		scroller.heights = scroller.displayBuffer.heights = [];
		scroller.pageOffset = 0;
		scroller.pageTop = 0;
		scroller.$.scroll.y = scroller.$.scroll.y0 = 0;
		scroller.updatePages();
	},

	onSearchAlbums: function (sender, strSearch) {
		this.log(strSearch);
		this.arAlbums = [];
		this.searchQuery = Utilities.fastTrim(strSearch);
		this.listQuery();
		return true;
	},

	listSetupRow: function (sender, intIndex) {
		var objAlbum;
		var charPrevLabelAlpha = null;
		var strCurrLabelAlpha;
		var trackCount;
		try {
			this.log(intIndex);
			if (this.arAlbums !== undefined && this.arAlbums[intIndex] !== undefined) {
				objAlbum = this.arAlbums[intIndex];
				this.log(objAlbum.name);
				this.$.albumName.setContent(objAlbum.name);
				this.$.albumArtist.setContent(objAlbum.artist);
				if (objAlbum.name.length > 0) {
					// _alphaLabel is precomputed once in _buildAlphaJumps - not recalculated
					// here (this runs on every row recycle during scrolling).
					if (this.arAlbums[intIndex - 1]) {
						charPrevLabelAlpha = this.arAlbums[intIndex - 1]._alphaLabel;
					}
					strCurrLabelAlpha = objAlbum._alphaLabel;
					if (strCurrLabelAlpha !== charPrevLabelAlpha || charPrevLabelAlpha === null) {
						this.log("Divider: " + strCurrLabelAlpha);
						this.$.divider.setContent(strCurrLabelAlpha);
						this.$.header.show();
					} else {
						this.$.header.hide();
					}
				}
				trackCount = objAlbum.trackCount || 0;
				this.$.albumCounts.setContent(trackCount === 1 ? this.local_track_Templ.evaluate({num: trackCount}) : this.local_tracks_Templ.evaluate({num: trackCount}));
				if (objAlbum.artUrl) {
					this.$.imgThumb.setSrc(objAlbum.artUrl);
					this.$.imgContainer.show();
					this.$.covers.removeClass("many");
				} else {
					this.$.imgContainer.hide();
					this.$.covers.removeClass("many");
				}
				this.$.itemMedia.addRemoveClass("odd", (intIndex % 2 === 0));
				return true;
			}
		} catch (err) {
			this.log("error: " + err);
		}
		return false;
	},

	onclick_listMedia: function (sender, event) {
		this.log();
		if (!this.boolSuspendClick) {
			this.callSelectAlbum(event.rowIndex);
		} else {
			this.boolSuspendClick = false;
		}
	},

	callSelectAlbum: function (intIndex, boolForcePlay) {
		var objClickedAlbum = this.arAlbums[intIndex];
		if (!objClickedAlbum) {
			return;
		}
		objClickedAlbum.boolForcePlay = boolForcePlay;
		this.doSelectAlbum(objClickedAlbum);
	},

	onclick_playAlbum: function () {
		this.log();
		this.callSelectAlbum(this.$.listMedia.fetchRowIndex(), true);
		return true;
	},

	callPlayAlbum: function (intIndex) {
		var objClickedAlbum = this.arAlbums[intIndex];
		var objGetMediaRequest;
		this.log();
		if (!objClickedAlbum) {
			return;
		}
		objGetMediaRequest = {
			where: [{prop: "album", op: "=", val: objClickedAlbum.name}, {prop: "artist", op: "=", val: objClickedAlbum.artist}],
			order: "trackNumber",
			mediaType: "song",
			boolForcePlay: true,
			strListType: "Album",
			strListText: objClickedAlbum.name,
			strArtist: objClickedAlbum.artist,
			playFirst: false
		};
		this.log("**** raising doRequestMedia for clicked album");
		this.log("**** objGetMediaRequest: " + enyo.json.stringify(objGetMediaRequest));
		this.doRequestMedia(objGetMediaRequest);
	},

	onError_imgThumb: function (sender) {
		this.error();
		this.log(sender.getSrc());
		this.$.imgContainer.setShowing(false);
	}
});