/*globals enyo, $L, event, Utilities, window, console */
enyo.kind({
	name: "kindListViewArtists",
	kind: "listViewDraggable",
	className: "playlist",
	published: {boolViewActive: false},
	events: {onSetPlaybackList: "", onRequestMedia: "", onListChanged: "", onListSorted: "", onSelectArtist: "", onRequestPlaylists: "", onShowBanner: ""},
	height: "100%",
	components: [
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchArtists", onSetMultiSelect: "onMultiSelect", boolShowMultiSelect: false},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{kind: "Control", layoutKind: "HFlexLayout", flex: 1, components: [
				{name: "listMedia", kind: "VirtualList", onSetupRow: "listSetupRow", className: "listMedia", flex: 1, components: [
					{name: "header", kind: "Control", className: "divider", style: "margin-top: -1px;", components: [{name: "divider", kind: "Control", className: "column"}]},
					{name: "itemMedia", kind: "draggableArtist", className: "artist", layoutKind: "HLayout", width: "100%", onclick: "onclick_listMedia", components: [
						{className: "column play", onclick: "onclick_playArtist", components: [
							{name: "imgPLay", kind: "ToolButton", icon: "images/bg_item_play.png"}
						]},
						{name: "covers", className: "column cover", components: [{name: "imgContainer", className: "img", showing: false, components: [{name: "imgThumb", kind: "Image", onerror: "onError_imgThumb"}]}]},
						{kind: "Control", style: "vertical-align: middle;", components: [
							{kind: "Control", layoutKind: "HLayout", components: [
								{name: "artistName", className: "column name", content: ""},
								{name: "songCount", className: "column count", content: ""}
							]},
							{name: "albumCount", className: "column", content: "2 albums"}
						]}
					]}
				]},
				{name: "alphaPicker", kind: "AlphaPicker", onAlphaPicked: "onAlphaPicked_AlphaPicker"}
			]}
		]},
		{name: "empty", kind: "Control", layoutKind: "VFlexLayout", align: "center", height: "100%", pack: "justify", className: "empty", showing: false, components: [
			{kind: "Spacer", flex: 1},
			{kind: "Control", className: "content", components: [
				{kind: "Image", src: "images/bg_empty_artists.png"},
				{content: $L("There are no artists available."), className: "heading"},
				{content: $L("Search Apple Music or populate artist results from your normalized media layer.")}
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
	intClickIndex: -1,
	strCurrListID: "",
	strSortMode: "name",
	boolSortAsc: true,
	boolMultiSelect: false,
	boolNotifyListChange: false,
	boolNeedRendered: true,
	objAlphaJumps: {},
	searchQuery: "",
	arArtists: [],

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
		this.local_albums_Templ = new enyo.g11n.Template($L("#{num} Albums"));
		this.local_album_Templ = new enyo.g11n.Template($L("#{num} Album"));
	},

	ready: function () {
		try {
			this.inherited(arguments);
			this.$.ctrlListViewHeader.setStrHeaderTitle($L("Artists"));
		} catch (err) {
			this.log("**** musiclibrary ready error: " + err);
		}
	},

	rendered: function () {
		this.inherited(arguments);
	},

	_normalizeArtist: function (objArtist) {
		var normalized = objArtist || {};
		normalized.id = normalized.id || "";
		normalized.name = normalized.name || normalized.artist || "";
		normalized.artUrl = normalized.artUrl || "";
		normalized.albumCount = normalized.albumCount || (normalized.total && normalized.total.albums) || 0;
		normalized.trackCount = normalized.trackCount || (normalized.total && normalized.total.tracks) || 0;
		return normalized;
	},

	renderList: function () {
		this.log();
		this.$.ctrlListViewHeader.clearSearchInput(false);
		this.intJumpRowOffset = 0;
		this.searchQuery = "";
		this.listQuery();
	},

	refreshList: function () {
		this.log();
		this.$.ctrlListViewHeader.clearSearchInput(false);
		this.intJumpRowOffset = 0;
		if (this.boolNeedRendered) {
			this.renderList();
		}
	},

	resizeList: function () {
		this.log();
		this.$.listMedia.resized();
	},

	listQuery: function () {
		var objGetMediaRequest = {where: [], mediaType: "artist", order: this.strSortMode, callback: enyo.bind(this, "gotArtists")};
		this.log();
		if (this.searchQuery) {
			objGetMediaRequest.queryType = "search";
			objGetMediaRequest.where = [{prop: "name", op: "%", val: this.searchQuery, collate: "primary"}];
		}
		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetMediaRequest);
		this.doRequestMedia(objGetMediaRequest);
	},

	gotArtists: function (inResponse, inRequest) {
		var objGetMediaRequest;
		var results;
		var intTrackIndex;
		this.log();
		this.log(inResponse);
		try {
			objGetMediaRequest = inRequest.objGetMediaRequest || {};
			results = (inResponse && inResponse.results) ? inResponse.results : [];
			this.arArtists = results.map(enyo.bind(this, function (artist) {
				return this._normalizeArtist(artist);
			}));
			if (this.arArtists.length > 0) {
				this.log("**** gotArtists");
				this.log("count: ", this.arArtists.length);
				this.log("--: ", this.arArtists[0].name);
			}
			this.boolNeedRendered = !!(objGetMediaRequest.queryType === "search" && objGetMediaRequest.where && objGetMediaRequest.where[0] && objGetMediaRequest.where[0].val.length > 0);
			if (this.arArtists) {
				this.$.ctrlListViewHeader.setIntHeaderCount(this.arArtists.length);
				if (this.arArtists.length > 0) {
					this.$.content.show();
					this.$.empty.hide();
					for (intTrackIndex = 0; intTrackIndex < this.arArtists.length; intTrackIndex++) {
						this.log(this.arArtists[intTrackIndex].name);
						this.arArtists[intTrackIndex].origIndex = intTrackIndex;
					}
					this.$.listMedia.resized();
					this.$.listMedia.punt();
					this._buildAlphaJumps();
				} else {
					this.$.content.hide();
					this.$.listMedia.punt();
					this._buildAlphaJumps();
					if (objGetMediaRequest.queryType === "search") {
						this.$.empty.hide();
					} else {
						this.$.empty.show();
					}
				}
			}
		} catch (err) {
			this.log("**** gotArtists error: " + err);
		}
	},

	// A-Z fast-scroll: mark which letters have at least one artist so AlphaPicker can
	// gray out the rest, then jump the list when a letter is tapped/dragged over.
	//
	// getBaseLabelChar loads a g11n Unicode character-data file with no persistent cache -
	// genuinely expensive per call. Precompute it ONCE here per artist as _alphaLabel so
	// listSetupRow (runs on every row recycle during scrolling, not just once per list load)
	// and onAlphaPicked_AlphaPicker just read the stored value instead of recalculating it
	// live - recalculating per-row on a big list is what caused a real scroll/performance
	// regression on the (much larger) Songs list; same fix applied here defensively.
	_buildAlphaJumps: function () {
		var jumps = {}, i, label;
		for (i = 0; i < this.arArtists.length; i++) {
			label = Utilities.getBaseLabelChar(this.arArtists[i].name);
			this.arArtists[i]._alphaLabel = label;
			jumps[label] = true;
		}
		this.objAlphaJumps = jumps;
		if (this.$.alphaPicker) {
			this.$.alphaPicker.populate(jumps);
		}
	},

	onAlphaPicked_AlphaPicker: function (sender, chrAlpha) {
		var i;
		for (i = 0; i < this.arArtists.length; i++) {
			if (this.arArtists[i]._alphaLabel === chrAlpha) {
				// listSetupRow reads arArtists[scrollRow + intJumpRowOffset] (currently
				// always 0 here, but stay correct if that ever changes).
				this._jumpListTo(Math.max(0, i - this.intJumpRowOffset));
				return;
			}
		}
	},

	// Enyo's VirtualList exposes no public "scroll to row" API in this framework version.
	// Walking there via setScrollPosition+scroll() (whether in one call or chunked into
	// small hops) still has to render every intervening row one at a time - fine for a
	// normal flick's short distance, but for row 5 -> row 690 that's genuinely ~700 rows of
	// real DOM creation/measurement no matter how it's spread across ticks (one call = froze
	// the app; chunked into small hops = no longer frozen, but just as slow overall, only
	// spread out - a multi-second "crawl" instead of an instant jump).
	//
	// The actual fix: reset the SAME internal pointers `punt()` already resets on every list
	// refresh (top/bottom/domBuffer/displayBuffer/contentHeight/heights/pageOffset/pageTop/
	// scroll.y), but anchored at the TARGET row instead of hardcoded 0. updatePages() then
	// only renders enough rows to fill the viewport (bounded by screen height, NOT by how
	// far the jump is) - a real O(viewport) jump regardless of distance, exactly like
	// landing fresh on row 0 after a refresh feels instant regardless of list length.
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

	onSearchArtists: function (sender, strSearch) {
		this.log(strSearch);
		this.intJumpRowOffset = 0;
		this.arArtists = [];
		this.searchQuery = Utilities.fastTrim(strSearch);
		this.listQuery();
		return true;
	},

	listSetupRow: function (sender, intIndex) {
		var objArtist;
		var charPrevLabelAlpha = null;
		var strCurrLabelAlpha;
		var rowIndex = intIndex + this.intJumpRowOffset;
		var albumCount;
		var trackCount;
		try {
			this.log(intIndex);
			this.log(rowIndex);
			if (this.arArtists !== undefined && rowIndex < this.arArtists.length && this.arArtists[rowIndex] !== undefined) {
				objArtist = this.arArtists[rowIndex];
				this.log(objArtist.name);
				this.$.artistName.setContent(objArtist.name);
				if (objArtist.name.length > 0) {
					// _alphaLabel is precomputed once in _buildAlphaJumps - not recalculated
					// here (this runs on every row recycle during scrolling).
					if (this.arArtists[rowIndex - 1]) {
						charPrevLabelAlpha = this.arArtists[rowIndex - 1]._alphaLabel;
					}
					strCurrLabelAlpha = objArtist._alphaLabel;
					if (strCurrLabelAlpha !== charPrevLabelAlpha || charPrevLabelAlpha === null) {
						this.log("Divider: " + strCurrLabelAlpha);
						this.$.divider.setContent(strCurrLabelAlpha);
						this.$.header.show();
					} else {
						this.$.header.hide();
					}
				}
				albumCount = objArtist.albumCount || 0;
				trackCount = objArtist.trackCount || 0;
				this.$.albumCount.setContent(albumCount !== 1 ? this.local_albums_Templ.evaluate({num: albumCount}) : this.local_album_Templ.evaluate({num: albumCount}));
				this.$.songCount.setContent(trackCount !== 1 ? this.local_tracks_Templ.evaluate({num: trackCount}) : this.local_track_Templ.evaluate({num: trackCount}));
				if (objArtist.artUrl) {
					this.$.imgThumb.setSrc(objArtist.artUrl);
					this.$.imgContainer.show();
					this.$.covers.removeClass("many");
				} else {
					this.$.imgContainer.hide();
					this.$.covers.removeClass("many");
				}
				this.$.itemMedia.addRemoveClass("odd", (rowIndex % 2 === 0));
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
			this.callSelectArtist(event.rowIndex);
		} else {
			this.boolSuspendClick = false;
		}
	},

	callSelectArtist: function (intIndex, boolForcePlay) {
		var objClickedArtist = this.arArtists[intIndex + this.intJumpRowOffset];
		if (!objClickedArtist) {
			return;
		}
		objClickedArtist.boolForcePlay = boolForcePlay;
		this.doSelectArtist(objClickedArtist);
	},

	onclick_playArtist: function () {
		this.log();
		this.callSelectArtist(this.$.listMedia.fetchRowIndex(), true);
		return true;
	},

	callPlayArtist: function (intIndex) {
		var objClickedArtist = this.arArtists[intIndex + this.intJumpRowOffset];
		var objGetMediaRequest;
		this.log();
		if (!objClickedArtist) {
			return;
		}
		objGetMediaRequest = {
			where: [{prop: "artist", op: "=", val: objClickedArtist.name}],
			order: "trackNumber",
			mediaType: "song",
			boolForcePlay: true,
			playFirst: false,
			strListType: "Artist",
			strListText: objClickedArtist.name
		};
		this.log("**** raising doRequestMedia for clicked artist");
		this.log("**** objGetMediaRequest: ", objGetMediaRequest);
		this.doRequestMedia(objGetMediaRequest);
	},

	onclick_imgMenu: function (sender, event) {
		this.log();
		this.intClickIndex = event.rowIndex;
		return true;
	},

	onMenuClick: function (sender, origSender) {
		this.log();
		this.log(sender);
		this.log(origSender);
		this.log(origSender.name);
		this.log(origSender.plindex);
		switch (origSender.name) {
		case "mitemPlay":
			this.callPlayArtist(this.intClickIndex);
			break;
		case "mitemView":
			this.callSelectArtist(this.intClickIndex);
			break;
		default:
			this.callAddToPlaylist(this.intClickIndex, origSender.plid);
			break;
		}
	},

	onMultiSelect: function () {
		this.log();
		this.boolMultiSelect = !this.boolMultiSelect;
		this.$.listMedia.setMultiSelect(this.boolMultiSelect);
	},

	onError_imgThumb: function (sender) {
		this.error();
		this.log(sender.getSrc());
		this.$.imgContainer.setShowing(false);
	}
});