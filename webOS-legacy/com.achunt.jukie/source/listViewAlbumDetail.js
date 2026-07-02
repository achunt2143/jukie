/*globals enyo, $L, event, Utilities, window, LibraryTools */
enyo.kind({
	name: "kindListViewAlbumDetail",
	kind: "listViewDetail",
	className: "DetailView",
	components: [
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchSongs", boolShowSearchBtn: false},
		{kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "listMedia", kind: "VirtualList", onQuery: "listQuery", onSetupRow: "listSetupRow", className: "listMedia", flex: 1, components: [
				{name: "headerAlbum", kind: "draggableAlbum", className: "header album first", showing: false, components: [
					{kind: "Control", className: "content", align: "center", layoutKind: "HFlexLayout", components: [
						{className: "cover", onclick: "onclick_playArtist", components: [
							{className: "img", components: [
								{name: "imgThumb", kind: "Image"}
							]}
						]},
						{kind: "Control", flex: 1, components: [
							{name: "albumName", className: "name", content: "Siamese Dream"},
							{name: "albumCounts", className: "count", content: "10 songs"}
						]}
					]}
				]},
				{name: "header", kind: "HFlexBox", className: "divider first", showing: false, components: [
					{name: "lblSortPos", content: $L("#"), className: "column number sorted", onclick: "onclick_Sort"},
					{name: "lblSortSong", content: $L("Song"), flex: 1, className: "column", onclick: "onclick_Sort"}
				]},
				{name: "itemMedia", kind: "draggableSong", layoutKind: "HFlexLayout", align: "center", className: "song", onclick: "onclick_listMedia", components: [
					{kind: "Control", name: "songPlaying", className: "column album_artist_Blueicon", showing: true},
					{name: "songTrack", className: "column number"},
					{name: "songTitle", flex: 1, className: "column title"}
				]}
			]}
		]},
		{name: "loading", kind: "Control", layoutKind: "VFlexLayout", align: "center", flex: 1, height: "100%", pack: "center", className: "empty", showing: false, components: [
			{kind: "SpinnerLarge", showing: true}
		]},
		{kind: "Toolbar", className: "enyo-toolbar-light", slidingHandler: true, components: [{kind: "GrabButton"}]},
		{name: "diagAlbumDetails", kind: "ModalDialog", width: "750px", height: "750px", dismissWithClick: true, components: [
			{layoutKind: "HFlexLayout", components: [
				{kind: "Control", style: "margin-right: 6px;", components: [
					{content: "Name: "},
					{content: "Artist: "},
					{content: "Genre: "},
					{content: "Year: "}
				]},
				{kind: "Control", style: "margin-right: 6px;", components: [
					{name: "lblAlbumName"},
					{name: "lblAlbumArtist"},
					{name: "lblAlbumGenre"},
					{name: "lblAlbumYear"}
				]},
				{kind: "Control", components: [
					{name: "imgAlbum", kind: "Image"}
				]}
			]},
			{content: "Tracks: "},
			{name: "listTracks", kind: "VirtualList", height: "200px;", onSetupRow: "listSetupRow_listTracks", components: [
				{name: "itemTrack", kind: "Item", components: [
					{name: "lblTrackName"}
				]}
			]}
		]}
	],

	listViewDetailType: "album",
	strSortMode: "pos",

	create: function () {
		try {
			this.inherited(arguments);
			this.listViewDetailType = "album";
		} catch (err) {
			this.log("**** create error: " + err);
		}
		this.local_tracks_Templ = new enyo.g11n.Template($L("(#{num} songs)"));
		this.local_track_Templ = new enyo.g11n.Template($L("(#{num} song)"));
		this.$.ctrlListViewHeader.setIntHeaderCount("");
	},

	ready: function () {
		this.inherited(arguments);
	},

	rendered: function () {
		this.inherited(arguments);
	},

	setStrHeaderTitle: function () {
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

	_albumArtUrl: function () {
		if (!this.objCurr) {
			return "";
		}
		return this.objCurr.artUrl || this.objCurr.strThumbURL || this.objCurr.strTrackImage || "";
	},

	listSetupRow: function (inSender, intIndex) {
		var objSong;
		var artUrl;
		try {
			this.log("intIndex: " + intIndex);
			if (this.arSongs !== undefined && this.arSongs[intIndex] !== undefined) {
				objSong = this.arSongs[intIndex];
				this.log("title: " + objSong.title);
				this.updateUISongInfo(objSong);
				this.$.songTrack.setContent(this._trackNumber(objSong, intIndex));
				this.setPlayingStyles(this._trackId(objSong), this.$.itemMedia, this._strListQuery + this.strSortMode);
				if (intIndex === 0) {
					this.$.albumName.setContent(objSong.album || (this.objCurr && this.objCurr.name) || "");
					if (this.arSongs.length !== 1) {
						this.$.albumCounts.setContent(this.local_tracks_Templ.evaluate({num: this.arSongs.length}));
					} else {
						this.$.albumCounts.setContent(this.local_track_Templ.evaluate({num: this.arSongs.length}));
					}
					this.$.headerAlbum.show();
					this.$.header.show();
					artUrl = this._albumArtUrl();
					if (artUrl !== "") {
						this.$.imgThumb.setSrc(artUrl);
						this.$.imgThumb.setShowing(true);
					} else {
						this.$.imgThumb.setShowing(false);
					}
				} else {
					this.$.headerAlbum.hide();
					this.$.header.hide();
				}
				this.$.itemMedia.addRemoveClass("odd", (intIndex % 2 === 0));
				return true;
			}
		} catch (err) {
			this.log("error: " + err);
		}
		return false;
	},

	setItemHighlighted: function (inHighlight) {
		if (this.dragObjType === "song") {
			this.$.itemMedia.addRemoveClass("selected", inHighlight);
		} else {
			this.$.headerAlbum.addRemoveClass("selected", inHighlight);
		}
	}
});