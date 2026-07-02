/*globals enyo, $L, event, Utilities, window, setTimeout, clearTimeout */
enyo.kind({
	name: "kindListViewSongs",
	kind: "listViewDraggable",
//	className: "playlist",
	published: {boolViewActive: false, boolRefreshData: true},
	events: {onSetPlaybackList: "", onRequestMedia: "", onRequestCurrTrackInfo: "", onListChanged: "", onListSorted: "", onEnableControls: ""},
	height: "100%",
	components: [
		// the header
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchSongs"},
		// the content
		{name: "content", kind: "Control", layoutKind:"VFlexLayout", className: "list", flex: 1, components: [
			// the divider
			{name: "header", kind: "Control", layoutKind: "HFlexLayout", className: "divider first", align:'center', components: [
				//{name: "lblNumber", content: $L("#"), className: "column number"},
				{name: "lblSortSong", content: $L("Song"), flex: 2, className: "column sorted", onclick: "onclick_Sort"},
				{name: "lblSortArtist", content: $L("Artist"), flex: 1, className: "column", onclick: "onclick_Sort"},
				{name: "lblSortAlbum", content: $L("Album"), flex: 1, className: "column", onclick: "onclick_Sort"}
			]},
			// the list
			{kind: "Control", layoutKind: "HFlexLayout", flex: 1, components: [
				{name: "listMedia", kind: "VirtualList", onSetupRow: "listSetupRow", flex: 1, components: [
					// per-row alphadivider header (named alphaDividerRow, not "header" -
					// that name is already taken by the static Song/Artist/Album sort row above)
					{name: "alphaDividerRow", kind: "Control", className: "divider", style: "margin-top: -1px;", components: [{name: "divider", kind: "Control", className: "column"}]},
					{name:"itemMedia", kind: "draggableSong", layoutKind:"HFlexLayout", className:'song', onclick: "onclick_listMedia", components: [
						//{name: "songNumber", content: '1', className: "column number"},
						{kind: "Control", name: "songPlaying", className: "column song_genre_Blueicon", showing: true},
						{name: "songTitle", flex: 2, className: "column title"},
						{name: "songArtist", flex: 1, className: "column artist"},
						{name: "songAlbum", flex: 1, className: "column album"}
					]}
				]},
				{name: "alphaPicker", kind: "AlphaPicker", onAlphaPicked: "onAlphaPicked_AlphaPicker"}
			]}
		]},
		// the empty view
		{name: "empty", kind: "Control", layoutKind: "VFlexLayout", align:"center", height:"100%", pack: "justify", className: "empty", showing: false, components: [
			{kind: "Spacer", flex: 1},
			{kind: "Control", className: "content", components: [
			  {kind: "Image", src: "images/bg_empty_songs.png"},
			  {content: $L("There are no songs available."), className: "heading"},
			  {content: $L("Search Apple Music to find songs to play.")}
			]},
			{kind: "Button", caption: $L("Add songs"), showing: false},
			{kind: "Spacer", flex: 3}
		]},
		{name: "loading", kind: "Control", layoutKind: "VFlexLayout", align: "center", flex: 1, height: "100%", pack: "center", className: "empty", showing: false, components: [
			{kind: "SpinnerLarge", showing: true}
		]},
		{name: "txtResults"}

    ],
	intCurrTrack:  -1,
	intCurrTrackOrigIndex:  -1,
	strCurrTrackID: "",
	strCurrTrackListQuery: "",

	searchQuery: "",

	strCurrListID: "",

	strSortMode: "title",
	boolSortAsc: true,

	arSongs: [],
	objAlphaJumps: {},

	boolNotifyListChange: false,

	strShowSongTitle: "",
	strShowSongArtist: "",

	_arrIntToSongIndex: [],
	_boolReloading : false,

	_boolWaitToJump: false,

	_strListQuery : "",
	//intJumpRowOffset: 0, inherrited from listViewDraggable

	create: function () {
		try
		{
			this.inherited(arguments);
			this.strSortMode = "title";
			this.boolSortAsc = true;
			this.strCurrListID = Utilities.generateGuid();
		}
		catch (err)
		{
			this.log("**** create error: " + err);
		}

	},

	ready: function () {

		this.inherited(arguments);
		this.$.ctrlListViewHeader.setStrHeaderTitle($L("Songs"));

	},

	rendered: function()
	{
		this.inherited(arguments);

	},


	renderList: function (objParams)
	{
		this.log();
		this.log("objParams: ", objParams);
		this.$.ctrlListViewHeader.clearSearchInput(false);
		this.searchQuery = "";
		this.strShowSongTitle = "";
		this.strShowSongArtist = "";
		this.intJumpRowOffset = 0;

		if(objParams)
		{
			if(objParams.strSongTitle)
			{
				this.strShowSongTitle = objParams.strSongTitle;
			}
			if(objParams.strSongArtist)
			{
				this.strShowSongArtist = objParams.strSongArtist;
			}
		}
		this.listQuery(objParams);

	},


	refreshList: function (objParams)
	{
		this.log();

		this.$.ctrlListViewHeader.clearSearchInput(false);
		this.doRequestCurrTrackInfo(objParams);


		if(this.boolRefreshData || this.searchQuery !== "")
		{
			this.searchQuery = "";
			this.listQuery(objParams);
			this.boolRefreshData = false;
		}

	},

	resizeList: function ()
	{
		this.$.listMedia.resized();
	},

	//overriding function in listViewDraggable
	setScrolling: function(bool){
		this.scrolling = bool;
		this._boolWaitToJump = true;
	},

	onTrackEnd: function(){

	},

	onTrackPlaying: function(){
		this._boolWaitToJump = false;
	},

	listQuery: function (objParams)
	{
		this._boolReloading = true;
		this._arrIntToSongIndex = [];
		this.intJumpRowOffset = 0;
		this._boolWaitToJump = false;

		var objGetMediaRequest = {where: [], mediaType: "song", order: this.strSortMode, desc: !this.boolSortAsc, callback: enyo.bind(this, "gotSongs"), objParams: objParams};

		if(this.strShowSongTitle !== "" && this.strShowSongArtist !== "")
		{
			objGetMediaRequest.where = [{"prop": "title", "op": "=", "val": this.strShowSongTitle}, {"prop": "artist", "op": "=", "val": this.strShowSongArtist}];
		}
		else if(this.searchQuery !== "")
		{
			objGetMediaRequest.queryType = "search";
			objGetMediaRequest.where = [{"prop": "title", "op": "%", "val": this.searchQuery, "collate": "primary"}];
		}

		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetMediaRequest);
		this.doRequestMedia(objGetMediaRequest);
	},


	gotSongs: function (inResponse, inRequest)
	{
		var objGetMediaRequest;
		var objParams;
		var results;
		var i;
		var punted;

		this.log();

		try
		{
			objGetMediaRequest = (inRequest && inRequest.objGetMediaRequest) || {};
			objParams = objGetMediaRequest.objParams;
			results = (inResponse && inResponse.results) ? inResponse.results : [];

			this.log("**** gotSongs");
			this.log("count: ", results.length);

			this.arSongs = results;
			this._arrIntToSongIndex = [];
			for(i = 0; i < this.arSongs.length; i++)
			{
				this.arSongs[i].origIndex = i;
				this._arrIntToSongIndex[this.arSongs[i].id] = i;
			}

			this.$.ctrlListViewHeader.setIntHeaderCount(this.arSongs.length);
			this.strCurrListID = Utilities.generateGuid();
			this._strListQuery = (objGetMediaRequest.queryType || "") + (this.searchQuery || "") + this.arSongs.length;

			this._buildAlphaJumps();

			punted = this._jumpIfNeeded(objParams);

			if(this.arSongs.length > 0)
			{
				this.$.content.show();

				if(punted === false)
				{
					if(this.strCurrTrackListQuery === this._strListQuery)
					{
						this._updateJumpRowOffset();
					}
					else
					{
						this.intJumpRowOffset = 0;
					}

					this.$.listMedia.punt();
				}

				this.$.empty.hide();

			}
			else
			{
				this.$.content.hide();

				this.$.listMedia.punt();

				if(objGetMediaRequest.queryType === "search")
				{
					this.$.empty.hide();
				}
				else
				{
					this.$.empty.show();
				}
			}
			this._boolReloading = false;
		}
		catch (err)
		{
			this.log("**** gotSongs error: " + err);

		}

	},

	// A-Z fast-scroll: keyed on whichever column is the ACTIVE sort (strSortMode is
	// "artist"|"title"|"album", matching the song object's own field names 1:1), since
	// that's what a letter actually groups by in the current sort order. Mark which
	// letters are present so AlphaPicker can gray out the rest, then jump on tap/drag.
	//
	// IMPORTANT: this is the ONLY place that calls Utilities.getBaseLabelChar (which loads a
	// g11n Unicode character-data file with no persistent cache - genuinely expensive per
	// call). It stashes the result on each song as _alphaLabel so listSetupRow - which runs on
	// EVERY row recycle during normal scrolling, not just once per list load - can just read
	// that precomputed value instead of recalculating it live. Recalculating it per row on a
	// 695-song list was the "scroll is broken/app is slow" regression; this is the fix.
	_buildAlphaJumps: function ()
	{
		var jumps = {}, i, field = this.strSortMode, label;
		for (i = 0; i < this.arSongs.length; i++)
		{
			label = Utilities.getBaseLabelChar(this.arSongs[i][field] || "");
			this.arSongs[i]._alphaLabel = label;
			jumps[label] = true;
		}
		this.objAlphaJumps = jumps;
		if (this.$.alphaPicker)
		{
			this.$.alphaPicker.populate(jumps);
		}
	},

	onAlphaPicked_AlphaPicker: function (sender, chrAlpha)
	{
		var i;
		for (i = 0; i < this.arSongs.length; i++)
		{
			if (this.arSongs[i]._alphaLabel === chrAlpha)
			{
				// listSetupRow reads arSongs[scrollRow + intJumpRowOffset] - this list can
				// have a nonzero offset (re-centers on the currently-playing track when you
				// come back to Songs), so the actual scroll target must subtract it back out.
				this._jumpListTo(Math.max(0, i - this.intJumpRowOffset));
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
	_jumpListTo: function (rowIndex)
	{
		var scroller = this.$.listMedia && this.$.listMedia.$.scroller;
		if (!scroller || !scroller.$.scroll || !scroller.domBuffer || !scroller.displayBuffer)
		{
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

	onSearchSongs: function (sender, strSearch)
	{

		this.log(strSearch);
		this.intJumpRowOffset = 0;

		this.arSongs = [];

		this.searchQuery = (Utilities.fastTrim(strSearch) === "") ? "" : strSearch;
		this.listQuery();
		return true;
	},

	listSetupRow: function (sender, intIndex)
	{
		try
		{
			//this.log("intIndex: " + intIndex);

			intIndex = intIndex  + this.intJumpRowOffset;

			if(this.arSongs !== undefined)
			{
				if(this.arSongs[intIndex] !== undefined)
				{
					//this.log("title: " + this.arSongs[intIndex].title);
					//this.log(this.arSongs[intIndex].title);

					//this.$.songNumber.content = intIndex + 1;
					//this.$.songNumber.setStyle("width: " + (this.arSongs.length+'').length * 0.8 + "em");
					this.$.songArtist.content = this.arSongs[intIndex].artist;
					this.$.songTitle.content = this.arSongs[intIndex].title;
					this.$.songAlbum.content = this.arSongs[intIndex].album;

					// Alphadivider header - _alphaLabel is precomputed ONCE per song in
					// _buildAlphaJumps, NOT recalculated here (this runs on every row recycle
					// during scrolling - recalculating a g11n-file-backed label live per row is
					// what caused the earlier scroll/performance regression).
					if (this.arSongs[intIndex]._alphaLabel &&
						(!this.arSongs[intIndex - 1] || this.arSongs[intIndex - 1]._alphaLabel !== this.arSongs[intIndex]._alphaLabel))
					{
						this.$.divider.setContent(this.arSongs[intIndex]._alphaLabel);
						this.$.alphaDividerRow.show();
					}
					else
					{
						this.$.alphaDividerRow.hide();
					}

					//if (this.arSongs[intIndex].origIndex === this.intCurrTrackOrigIndex) Discontinued use of origIndex to match for highlight
					this.setPlayingStyles(this.arSongs[intIndex]._id, this.$.itemMedia, this._strListQuery);

					this.$.itemMedia.addRemoveClass("odd", (intIndex % 2 === 0 ));
					//this.log("finshed");
					//this.$.itemMedia.setContent("-----");
					return true;
				}
			//return true;
			}


		}
		catch(err)
		{
			this.log("error: " + err);
		}

		return false;

	},


	onclick_Sort: function (objSender)
	{
		var boolNewSortAsc;

		switch (objSender.name)
		{

			case "lblSortArtist":

				boolNewSortAsc = this.strSortMode !== "artist" || (this.strSortMode === "artist" && !this.boolSortAsc);
				this.strSortMode = "artist";
				this.boolSortAsc = boolNewSortAsc;
				break;

			case "lblSortSong":

				boolNewSortAsc = this.strSortMode !== "title" || (this.strSortMode === "title" && !this.boolSortAsc);
				this.strSortMode = "title";
				this.boolSortAsc = boolNewSortAsc;
				break;

			case "lblSortAlbum":

				boolNewSortAsc = this.strSortMode !== "album" || (this.strSortMode === "album" && !this.boolSortAsc);
				this.strSortMode = "album";
				this.boolSortAsc = boolNewSortAsc;
				break;
		}

		this.resetMusicListHeaders();

		objSender.addClass("sorted");
		objSender.addRemoveClass("asc", boolNewSortAsc ? true : false);
		objSender.addRemoveClass("desc", !boolNewSortAsc ? true : false);

		this.listQuery();

		this.doListChanged(this.arSongs, this.intCurrTrackOrigIndex);

	},

	resetMusicListHeaders: function ()
	{
		for(var intChildIndex = 0; intChildIndex < this.$.header.children.length; intChildIndex++)
		{
			this.$.header.children[intChildIndex].removeClass("desc");
			this.$.header.children[intChildIndex].removeClass("asc");
			this.$.header.children[intChildIndex].removeClass("sorted");
		}
	},

	onclick_listMedia: function (sender, event)
	{

		this.log("this.boolSuspendClick: " + this.boolSuspendClick);

		if(!this.boolSuspendClick)
		{

			var intClickIndex =  event.rowIndex + this.intJumpRowOffset;

			this.log(event.rowIndex);
			this.log(intClickIndex);

			var objSong = this.arSongs[intClickIndex];

			var objSetPlaybackList = {arThumbnails: objSong.arThumbnails,
										arSetPlaybackList: this.arSongs,
										intStartTrackIndex: intClickIndex,
										intStartTrackTime: 0,
										strOriginListID: this.strCurrListID,
										strListType: "Song",
										strListText: objSong.title,
										strListSubText: objSong.artist,
										strListQuery:	this._strListQuery
									};
			this.doSetPlaybackList(objSetPlaybackList);

		}
		else
		{
			this.boolSuspendClick = false;
		}

	},

	//jumps and punts if forcing or in original list, and song exists
	_jumpIfNeeded: function(objParams){
		//if we are in the original list or are forcing jump
		if((objParams && objParams.forceJump === true) || this.strCurrTrackListQuery === this._strListQuery)
		{
			//if we haven't scrolled yet
			if(this._boolWaitToJump === false)
			{
				if(this._updateJumpRowOffset())
				{
					this.$.listMedia.punt();
					return true;
				}
			}
		}
		return false;
	},

	_updateJumpRowOffset: function(){
		if(this._arrIntToSongIndex[this.strCurrTrackID]!==undefined){
			//Don't jump to the bottom 11 songs to prevent empty view
			this.intJumpRowOffset = Math.max(Math.min(this._arrIntToSongIndex[this.strCurrTrackID] - 1, this.arSongs.length - 12), 0);
			return true;
		}
		return false;
	},

	highlightTrack: function (objTrackInfo, forceJump)
	{
		try
		{
			if(objTrackInfo)
			{
				this.log(objTrackInfo.intTrackIndex);
				this.intCurrTrack = objTrackInfo.intTrackIndex;
				this.intCurrTrackOrigIndex = objTrackInfo.intTrackOrigIndex;
				this.strCurrTrackID = objTrackInfo.strTrackID;
				this.strCurrTrackListQuery = objTrackInfo.strListQuery;

				this.log(this.intCurrTrack);
				if(forceJump || (!this._boolWaitToJump  && this.strCurrTrackListQuery === this._strListQuery)){

					//if we updateJumpRowOffset, we're in the active view, and we aren't rendering
					if(this._updateJumpRowOffset(objTrackInfo.strTrackID) && this.boolViewActive && !this._boolRendering)
					{
						this.$.listMedia.punt();
					}
				}
				else
				{
					if(this.boolViewActive && !this._boolRendering)
					{
						this.$.listMedia.refresh();
					}
				}
				this.log("this.intJumpRowOffset", this.intJumpRowOffset);

			}


		}
		catch(err)
		{
			this.log("error:" + err);
		}

	}


});
