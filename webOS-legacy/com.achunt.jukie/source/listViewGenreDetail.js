/*globals enyo, $L, event, Utilities, window, LibraryTools */
enyo.kind({
	name: "kindListViewGenreDetail",
	kind: "listViewDetail",
	className: "playlist",
	components: [
		{kind: "ctrlListViewHeader", onSearch_Header: "onSearchSongs", boolShowSearchBtn: false},
		{kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "header", kind: "Control", layoutKind: "HFlexLayout", className: "divider first", align: "center", components: [
				{name: "lblSortSong", content: $L("Song"), flex: 2, className: "column", onclick: "onclick_Sort"},
				{name: "lblSortArtist", content: $L("Artist"), flex: 1, className: "column sorted down", onclick: "onclick_Sort"},
				{name: "lblSortAlbum", content: $L("Album"), flex: 1, className: "column", onclick: "onclick_Sort"}
			]},
			{name: "listMedia", kind: "VirtualList", onQuery: "listQuery", onSetupRow: "listSetupRow", className: "listMedia", flex: 1, components: [
				{name: "itemMedia", kind: "draggableSong", className: "song", layoutKind: "HFlexLayout", onclick: "onclick_listMedia", components: [
					{kind: "Control", name: "songPlaying", className: "column song_genre_Blueicon", showing: true},
					{name: "songTitle", flex: 2, className: "column title"},
					{name: "songArtist", flex: 1, className: "column artist"},
					{name: "songAlbum", flex: 1, className: "column album"}
				]}
			]},
			{kind: "Toolbar", className: "enyo-toolbar-light", slidingHandler: true, components: [{kind: "GrabButton"}]}
		]}
	],

	strSortMode: "artist",
	listViewDetailType: "genre",

	create: function () {
		try {
			this.inherited(arguments);
			this.strSortMode = "artist";
			this.listViewDetailType = "genre";
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

	listSetupRow: function (inSender, intIndex) {
		var objSong;
		try {
			this.log("intIndex: " + intIndex);
			if (this.arSongs !== undefined && this.arSongs[intIndex] !== undefined) {
				objSong = this.arSongs[intIndex];
				this.log("title: " + objSong.title);
				this.$.songTitle.setContent(objSong.title || "");
				this.$.songArtist.setContent(objSong.artist || "");
				this.$.songAlbum.setContent(objSong.album || "");
				this.$.itemMedia.setClassName("enyo-item song");
				this.setPlayingStyles(this._trackId(objSong), this.$.itemMedia, this._strListQuery + this.strSortMode);
				this.$.itemMedia.addRemoveClass("odd", (intIndex % 2 !== 0));
				return true;
			}
		} catch (err) {
			this.log("error: " + err);
		}
		return false;
	}
});