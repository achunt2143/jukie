/*globals enyo, $L, event, Utilities, window, LibraryTools */
enyo.kind({
	name: "kindListViewArtistDetail",
	kind: "listViewDetail",
	height: "100%",
	events: {onResetView: ""},
	className: "artistDetail",
	components: [
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchSongs", boolShowSearchBtn: false},
		{kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "txtResults"},
			{name: "listMedia", kind: "VirtualList", onQuery: "listQuery", onSetupRow: "listSetupRow", className: "scroll", flex: 1, components: [
				{name: "itemMedia", kind: "draggableItem", className: "ArtistDetailMedia", onclick: "onclick_listMediaFilter", onmousehold: "mousehold_itemmedia", components: [
					{name: "headerAlbum", kind: "Item", className: "header album", showing: false, components: [
						{kind: "Control", className: "content", align: "center", layoutKind: "HFlexLayout", components: [
							{className: "cover", onclick: "onclick_playArtist", components: [
								{name: "imgContainer", className: "img", components: [
									{name: "imgThumb", kind: "Image", className: "thumb"}
								]}
							]},
							{kind: "Control", components: [
								{name: "albumName", className: "name", content: "Siamese Dream"},
								{name: "albumCounts", className: "count", content: "10 songs", showing: false}
							]}
						]}
					]},
					{name: "header", kind: "Control", layoutKind: "HFlexLayout", className: "divider first", align: "center", showing: false, components: [
						{name: "lblSortPos", content: $L("#"), className: "column number sorted", onclick: "onclick_Sort"},
						{name: "lblSortSong", content: $L("Song"), flex: 10, className: "column", onclick: "onclick_Sort"},
						{name: "lblSortAlbum", content: $L("Time"), flex: 2, className: "column", showing: false}
					]},
					{name: "song", kind: "Item", layoutKind: "HFlexLayout", className: "song", components: [
						{kind: "Control", name: "songPlaying", className: "column album_artist_Blueicon", showing: true},
						{name: "songTrack", className: "column number"},
						{name: "songTitle", flex: 10, className: "column title"},
						{name: "songTime", flex: 2, className: "column time", showing: false}
					]}
				]}
			]}
		]},
		{name: "loading", kind: "Control", layoutKind: "VFlexLayout", align: "center", flex: 1, height: "100%", pack: "center", className: "empty", showing: false, components: [
			{kind: "SpinnerLarge", showing: true}
		]},
		{kind: "Toolbar", className: "enyo-toolbar-light", slidingHandler: true, components: [{kind: "GrabButton"}]}
	],

	listViewDetailType: "artist",
	strSortMode: "pos",

	create: function () {
		try {
			this.inherited(arguments);
			this.$.ctrlListViewHeader.setIntHeaderCount("");
			this.listViewDetailType = "artist";
		} catch (err) {
			this.log("**** create error: " + err);
		}
	},

	ready: function () {
		this.inherited(arguments);
	},

	rendered: function () {
		this.inherited(arguments);
	},

	_trackId: function (objSong) {
		return objSong ? (objSong.id || objSong._id || "") : "";
	},

	_trackNumber: function (objSong, intIndex) {
		if (!objSong) {
			return intIndex + 1;
		}
		return objSong.trackNumber || (objSong.track && objSong.track.position) || (intIndex + 1);
	},

	_trackArtUrl: function (objSong) {
		if (!objSong) {
			return "";
		}
		return objSong.artUrl || objSong.strTrackImage || "";
	},

	listSetupRow: function (inSender, intIndex) {
		var objSong;
		var strPrevItemAlbum = null;
		var intAlbumStartIndex = 0;
		var artUrl;
		try {
			this.log(intIndex);
			if (this.arSongs !== undefined && this.arSongs[intIndex] !== undefined) {
				objSong = this.arSongs[intIndex];
				this.log("title: ", objSong.title);
				this.updateUISongInfo(objSong);
				this.$.songTrack.setContent(this._trackNumber(objSong, intIndex));
				this.setPlayingStyles(this._trackId(objSong), this.$.song, this._strListQuery + this.strSortMode);
				if (this.arSongs[intIndex - 1]) {
					strPrevItemAlbum = this.arSongs[intIndex - 1].album;
				}
				this.log(strPrevItemAlbum);
				this.log(objSong.album);
				if (strPrevItemAlbum === null || objSong.album !== strPrevItemAlbum) {
					intAlbumStartIndex = intIndex;
					this.$.headerAlbum.addClass("first");
					this.$.headerAlbum.show();
					this.$.header.show();
					this.$.albumName.setContent(objSong.album);
					artUrl = this._trackArtUrl(objSong);
					if (artUrl !== "") {
						this.log("thumbnail: ", artUrl);
						this.$.imgThumb.setSrc(artUrl);
						this.$.imgContainer.show();
					} else {
						this.log("No thumbnail");
						this.$.imgContainer.hide();
					}
				} else {
					this.$.headerAlbum.removeClass("first");
					this.$.headerAlbum.hide();
				}
				this.log("song addRemoveClass");
				this.$.song.addRemoveClass("odd", ((intIndex - intAlbumStartIndex) % 2 === 0));
				this.log("Returning true");
				return true;
			}
			this.log("Record not found");
		} catch (err) {
			this.log("error: " + err);
		}
		return false;
	},

	onclick_listMediaFilter: function (sender, event) {
		var domTarget = event.dispatchTarget;
		while (domTarget && domTarget.parent && domTarget.id !== "musicPlayerApp_listViewArtistDetail_itemMedia") {
			if (domTarget.id === "musicPlayerApp_listViewArtistDetail_headerAlbum" || domTarget.id === "musicPlayerApp_listViewArtistDetail_header") {
				return;
			}
			domTarget = domTarget.parent;
		}
		this.onclick_listMedia(sender, event);
	},

	onclick_grabButton: function () {
		this.log();
		this.doResetView();
	},

	mousehold_itemmedia: function (sender, event) {
		var domTarget = event.dispatchTarget;
		this.dragObjType = "song";
		while (domTarget && domTarget.parent && domTarget.id !== "musicPlayerApp_listViewArtistDetail_itemMedia") {
			if (domTarget.id === "musicPlayerApp_listViewArtistDetail_headerAlbum") {
				this.albumMousehold(sender, event);
				return;
			}
			if (domTarget.id === "musicPlayerApp_listViewArtistDetail_header") {
				return;
			}
			domTarget = domTarget.parent;
		}
		this.songMousehold(sender, event);
	},

	setItemHighlighted: function (inHighlight) {
		if (this.dragObjType === "song") {
			this.$.song.addRemoveClass("selected", inHighlight);
		} else {
			this.$.headerAlbum.addRemoveClass("selected", inHighlight);
		}
	}
});