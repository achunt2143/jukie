/*globals enyo, $L, event, Utilities, window, LibraryTools */
enyo.kind({
	name: "listViewDetail",
	kind: "listViewDraggable",

	published: {boolViewActive: false, boolListRendered: false},
	events: {onSetPlaybackList: "", onRequestMedia: "", onRequestCurrTrack: "", onListChanged: "", onListSorted: ""},

	objCurr: {},
	intCurrTrack: -1,
	intCurrTrackOrigIndex: -1,
	strCurrTrackID: "",
	strSortMode: "album",
	strCurrListID: "",
	boolSortAsc: true,
	listViewDetailType: "",
	_strListQuery: "",
	strDbNext: "",

	create: function () {
		this.inherited(arguments);
		this.intCurrTrack = -1;
		this.intCurrTrackOrigIndex = -1;
		this.boolSortAsc = true;
		this.strSortMode = "album";
		this.strCurrListID = Utilities.generateGuid();
	},

	_normalizeSong: function (objSong) {
		var normalized = objSong || {};
		normalized.id = normalized.id || normalized._id || normalized.path || "";
		normalized.title = normalized.title || "";
		normalized.artist = normalized.artist || "";
		normalized.album = normalized.album || "";
		normalized.trackNumber = normalized.trackNumber || (normalized.track && normalized.track.position) || 0;
		normalized.artUrl = normalized.artUrl || Utilities.artworkUrl(normalized.artwork || normalized.artUrl || "", 320);
		normalized.playable = (normalized.playable !== false);
		return normalized;
	},

	renderList: function (obj)
	{
		this.log();
		this.arSongs = [];
		this.strDbNext = "";

		if (obj === undefined)
		{
			obj = this.objCurr;
		}
		if (obj === undefined)
		{
			return;
		}

		this.$.ctrlListViewHeader.setIntHeaderCount("");
		this.strCurrListID = Utilities.generateGuid();
		this.objCurr = obj;
		this.setStrHeaderTitle(obj.name || "");
		this.$.listMedia.hide();
		this.listQuery();
	},

	listQuery: function () {
		var objGetMediaRequest = {where: [], mediaType: "song", callback: enyo.bind(this, "gotSongs")};
		this.log();
		switch (this.listViewDetailType)
		{
		case "genre":
			objGetMediaRequest.where = [{prop: "genre", op: "=", val: this.objCurr.name}];
			objGetMediaRequest.desc = !this.boolSortAsc;
			objGetMediaRequest.order = this.strSortMode;
			break;
		case "album":
			objGetMediaRequest.where = [{prop: "album", op: "=", val: this.objCurr.name}];
			if (this.objCurr.artist) {
				objGetMediaRequest.where.push({prop: "artist", op: "=", val: this.objCurr.artist});
			}
			objGetMediaRequest.order = "trackNumber";
			this.strSortMode = "pos";
			// Real catalog id of the clicked album (if this came from Apple Music catalog
			// browsing, not Your Library) - lets app.js fetch the actual album+tracks
			// instead of falling back to a text search.
			objGetMediaRequest.catalogAlbumId = this.objCurr.id || "";
			break;
		case "artist":
			objGetMediaRequest.where = [{prop: "artist", op: "=", val: this.objCurr.name}];
			objGetMediaRequest.order = "trackNumber";
			this.strSortMode = "pos";
			objGetMediaRequest.catalogArtistId = this.objCurr.id || "";
			break;
		default:
			return;
		}
		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetMediaRequest);
		this.doRequestMedia(objGetMediaRequest);
	},

	refreshList: function ()
	{
		this.log();
		this.$.listMedia.refresh();
		this.doRequestCurrTrack();
	},

	resizeList: function ()
	{
		this.log();
		this.$.listMedia.resized();
	},

	setStrHeaderTitle: function (name) {
		this.$.ctrlListViewHeader.setStrHeaderTitle(name);
	},

	gotSongs: function (inResponse, inRequest)
	{
		var results;
		var requestData;
		try
		{
			this.log("**** gotSongs");
			results = (inResponse && inResponse.results) ? inResponse.results : [];
			this.log("count: " + results.length);
			requestData = inRequest.objGetMediaRequest || {};
			this.arSongs = results.map(enyo.bind(this, function (song) {
				return this._normalizeSong(song);
			}));
			if (this.arSongs.length > 0)
			{
				this.log("--: " + this.arSongs[0].title);
			}
			this.$.ctrlListViewHeader.setIntHeaderCount(this.arSongs.length);
			this._strListQuery = enyo.json.stringify(requestData) + (inResponse.count || this.arSongs.length);
			if (this.arSongs.length > 0)
			{
				this.strCurrAlbum = "";
				this.$.listMedia.show();
				this.$.listMedia.resized();
				this.$.listMedia.punt();
				this.doRequestCurrTrack();
				if (this.objCurr.boolForcePlay)
				{
					this.onclick_listMedia(null, {rowIndex: 0});
					this.objCurr.boolForcePlay = false;
				}
			}
			else
			{
				this.$.listMedia.punt();
				if (this.$.txtResults && this.objCurr.boolShowContent)
				{
					this.$.txtResults.setContent($L("No ") + this.listViewDetailType + $L(" found"));
				}
			}
			this.boolListRendered = true;
		}
		catch (err)
		{
			this.log("**** gotSongs error: " + err);
		}
	},

	onclick_Sort: function (objSender, event) {
		var objFirstSong;
		var boolNewSortAsc;
		var arAlbumSongs;
		var endIndex;
		var sortType;
		try
		{
			objFirstSong = this.arSongs[event.rowIndex];
			this.log("onclick_Sort: " + objSender.name + " - " + this.boolSortAsc);
			this.log("curr sort mode " + this.strSortMode);
			arAlbumSongs = this.arSongs;
			if (this.listViewDetailType === "artist")
			{
				for (endIndex = event.rowIndex; endIndex < this.arSongs.length; endIndex++)
				{
					this.log(endIndex, this.arSongs[endIndex]);
					if (this.arSongs[endIndex].album !== objFirstSong.album)
					{
						break;
					}
				}
				arAlbumSongs = this.arSongs.slice(event.rowIndex, endIndex);
			}
			sortType = objSender.name.substr(7).toLowerCase();
			if (sortType === "song")
			{
				sortType = "title";
			}
			if (sortType !== "title" && sortType !== "pos" && sortType !== "artist" && sortType !== "album")
			{
				return;
			}
			boolNewSortAsc = this.strSortMode !== sortType || (this.strSortMode === sortType && !this.boolSortAsc);
			this.strSortMode = sortType;
			this.boolSortAsc = boolNewSortAsc;
			this.log("set to " + this.boolSortAsc);
			this.resetMusicListHeaders();
			objSender.addClass("sorted");
			objSender.addRemoveClass("asc", boolNewSortAsc);
			objSender.addRemoveClass("desc", !boolNewSortAsc);
			if (this.listViewDetailType === "genre")
			{
				this.listQuery();
			}
			else
			{
				LibraryTools.sort(this.strSortMode, arAlbumSongs, boolNewSortAsc);
				if (this.listViewDetailType === "artist")
				{
					Array.prototype.splice.apply(this.arSongs, [event.rowIndex, endIndex - event.rowIndex].concat(arAlbumSongs));
				}
				else
				{
					this.arSongs = arAlbumSongs;
				}
				this.$.listMedia.refresh();
			}
			this.strCurrListID = Utilities.generateGuid();
			this.doListChanged(this.arSongs, this.intCurrTrackOrigIndex);
		}
		catch (err)
		{
			this.log("**** onclick_Sort error: " + err);
		}
	},

	updateUISongInfo: function (objSong) {
		if (typeof objSong === "undefined") {
			return;
		}
		if (Utilities.isNumeric(objSong.trackNumber) && objSong.trackNumber > 0)
		{
			this.$.songTrack.setContent(objSong.trackNumber);
		}
		else
		{
			this.$.songTrack.setContent("-");
		}
		this.$.songTitle.setContent(objSong.title);
	},

	resetMusicListHeaders: function ()
	{
		var intChildIndex;
		for (intChildIndex = 0; intChildIndex < this.$.header.children.length; intChildIndex++)
		{
			this.$.header.children[intChildIndex].addClass("column");
			this.$.header.children[intChildIndex].removeClass("sorted");
			this.$.header.children[intChildIndex].removeClass("asc");
			this.$.header.children[intChildIndex].removeClass("desc");
		}
	},

	onclick_listMedia: function (sender, event)
	{
		var intClickIndex = event.rowIndex;
		var objSetPlaybackList = {
			arSetPlaybackList: this.arSongs,
			intStartTrackIndex: intClickIndex,
			intStartTrackTime: 0,
			strOriginListID: this.strCurrListID,
			strListType: Utilities.capitalize(this.listViewDetailType),
			strListText: this.objCurr.name,
			strListSubText: "",
			strArtist: this.objCurr.artist,
			strListQuery: (this._strListQuery + this.strSortMode),
			arThumbnails: this.objCurr.artUrl ? [{data: this.objCurr.artUrl}] : []
		};
		this.log(event.rowIndex);
		this.doSetPlaybackList(objSetPlaybackList);
	}
});