/*globals enyo, $L, event, Utilities, window, LibraryTools */
enyo.kind({
	name: "kindListViewPlaylist",
	kind: "listViewDraggable",
	pack: "start",
	className: "playlist",
	published: {boolViewActive: false, boolListRendered: false, strPlaybackListID: ""},
	height: "100%",
	events: {onSetPlaybackList: "", onRequestMedia: "", onRequestPlaylist: "", onRequestCurrTrack: "", onUpdatePlaylist: "", onDeletePlaylist: "", onEditPlaylist: "", onAddToPlaylist: "", onItemDrag: "", onItemShowAvatar: "", onItemShowAvatarIcon: ""},
	components: [
		{name: "paneHeader", components: [
			{kind: "ctrlListViewHeader", onSearch_Header: "onSearchSongs", onEditMode: "onStartEdit", boolShowEditPlaylist: true, boolShowSearchBtn: false},
			{name: "HeaderEdit", kind: "Toolbar", style: "background-color:#155989", pack: "justify", showing: false, components: [
				{name: "txtPlaylistName", kind: "ToolInput", hint: $L("Playlist Name"), autocorrect: false, spellcheck: false, style: "margin-left:5px"},
				{kind: "Spacer", flex: 1},
				{caption: $L("Cancel"), kind: "Button", className: "enyo-button-dark", style: "background-color:rgba(0,0,0,0.25);padding-left:1.2em;padding-right:1.2em;", onclick: "onCancelEdit"},
				{caption: $L("Done"), kind: "Button", className: "enyo-button-dark", onclick: "onDoneEdit", style: "background-color:rgba(0,0,0,0.25);padding-left:1.2em;padding-right:1.2em;margin:3px 5px"}
			]}
		]},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "header", kind: "Control", layoutKind: "HFlexLayout", className: "divider first", align: "center", components: [
				{name: "lblSortPos", content: $L("#"), className: "column number sorted", onclick: "onclick_Sort"},
				{name: "lblSortSong", content: $L("Song"), flex: 1, className: "column", onclick: "onclick_Sort"},
				{name: "lblSortArtist", content: $L("Artist"), flex: 1, className: "column down", onclick: "onclick_Sort"}
			]},
			{name: "listMedia", kind: "VirtualList", onSetupRow: "listSetupRow", flex: 1, components: [
				{name: "itemMedia", kind: "draggableSong", layoutKind: "HFlexLayout", className: "song", onclick: "onclick_listMedia", components: [
					{kind: "Control", name: "songPlaying", className: "column", showing: true},
					{name: "songNumber", content: "1", className: "column number", showing: true},
					{name: "songTitle", flex: 1, className: "column title"},
					{name: "songArtist", flex: 1, className: "column artist"},
					{name: "songAlbum", flex: 1, className: "column sAlbum", showing: false},
					{kind: "Control", name: "colDeleteItem", onclick: "onclick_btnDeleteItem", className: "delete", showing: false}
				]}
			]}
		]},
		{name: "txtResults", className: "empty"},
		{name: "empty", kind: "Control", layoutKind: "VFlexLayout", align: "center", height: "100%", pack: "justify", className: "empty", showing: false, components: [
			{kind: "Spacer", flex: 1},
			{kind: "Image", src: "images/bg_empty_songs.png"},
			{content: $L("There are no songs in this playlist."), className: "heading"},
			{content: $L("Drag and drop songs onto this playlist's navigation item to add songs to it."), className: "subheading"},
			{kind: "Spacer", flex: 3}
		]},
		{name: "footerEdit", kind: "Toolbar", className: "enyo-toolbar-light", pack: "end", showing: false, components: [
			{kind: "Button", caption: $L("Add Songs"), showing: false},
			{name: "btnDeletePlaylist", caption: $L("Delete Playlist"), onclick: "onclick_btnDeletePlaylist", style: "padding-left:1.2em;padding-right:1.2em;"}
		]},
		{name: "popupConfirmDone", kind: "ModalDialog", components: [
			{content: $L("Delete the selected songs?"), className: "confirm-content"},
			{name: "promptConfirmDone", kind: "ConfirmPrompt", className: "confirmpromptbox", confirmCaption: $L("Delete"), onConfirm: "onConfirmDone", onCancel: "onCancelDone"}
		]},
		{name: "popupConfirmDelete", kind: "ModalDialog", components: [
			{content: $L("Delete this playlist?"), className: "confirm-content"},
			{name: "promptConfirmDelete", kind: "ConfirmPrompt", className: "confirmpromptbox", confirmCaption: $L("Delete"), onConfirm: "onConfirmDelete", onCancel: "onCancelDelete"}
		]}
	],

	intCurrTrack: -1,
	intCurrTrackOrigIndex: -1,
	strCurrTrackID: "",
	strCurrTrackListQuery: "",
	strCurrListID: "",
	strPlaylistName: "",
	strPlaylistID: "",
	strPlaylistKind: "",
	searchQuery: "",
	boolSortAsc: true,
	boolEditMode: false,
	arUpdateTracks: [],
	arSongs: [],
	arPlaylists: [],
	boolNotifyListChange: false,
	_strListQuery: "{}",

	create: function () {
		try {
			this.inherited(arguments);
			this.strSortMode = "position";
			this.boolSortAsc = true;
			this.strCurrListID = Utilities.generateGuid();
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

	renderList: function (objParams) {
		this.log("objParams: ", objParams);
		try {
			if (objParams === undefined) {
				objParams = {
					strPlaylistName: this.strPlaylistName,
					strPlaylistID: this.strPlaylistID,
					strPlaylistKind: this.strPlaylistKind
				};
			}

			if (objParams.strPlaylistID !== undefined && objParams.strPlaylistID !== "") {
				this.boolEditMode = false;
				this.$.txtResults.setContent($L("Playlist Deleted"));

				if (this.strPlaylistID !== objParams.strPlaylistID) {
					this.strCurrListID = Utilities.generateGuid();
				}

				this.strPlaylistID = objParams.strPlaylistID || "";
				this.strPlaylistKind = objParams.strPlaylistKind || "com.palm.music.staticplaylists:1";
				this.arSongs = [];
				this.searchQuery = "";
				this.$.ctrlListViewHeader.clearSearchInput(false);
				this.doRequestCurrTrack();
				this.getPlaylist();
				this.resetMusicListHeaders();
				this.$.lblSortPos.addClass("sorted");
			} else {
				this.playlistDeleted();
			}
		} catch (err) {
			this.log("err: " + err);
		}
	},

	refreshList: function () {
		this.log();
		this.$.listMedia.refresh();
		this.doRequestCurrTrack();
	},

	resizeList: function () {
		this.log();
		this.$.listMedia.resized();
	},

	getPlaylist: function () {
		var objGetPlaylistsRequest;
		this.log();
		if (this.strPlaylistID !== "") {
			objGetPlaylistsRequest = {
				where: [{prop: "_id", op: "=", val: this.strPlaylistID}],
				playlistKind: this.strPlaylistKind,
				callback: enyo.bind(this, "gotPlaylist")
			};
			this.log("**** raising doRequestMedia");
			this.log("**** objGetMediaRequest: ", objGetPlaylistsRequest);
			this.doRequestPlaylist(objGetPlaylistsRequest);
		} else {
			this.log("Missing minimum params");
		}
	},

	gotPlaylist: function (inResponse) {
		var playlist;
		this.log();
		try {
			this.log(inResponse);
			if (inResponse.results) {
				this.arPlaylists = inResponse.results.slice(0);
				this.log("this.arPlaylists.length: " + this.arPlaylists.length);
				this.$.ctrlListViewHeader.setBoolShowSearchBtn(true);
				this.$.ctrlListViewHeader.setBoolShowEditPlaylist(true);

				if (this.arPlaylists.length > 0) {
					playlist = this.arPlaylists[0];
					this.strTracksArrayName = "tracks";
					this.strTitleProp = "name";
					if (this.strTitleProp && playlist[this.strTitleProp]) {
						this.$.ctrlListViewHeader.setStrHeaderTitle(playlist[this.strTitleProp]);
						this.strPlaylistName = playlist[this.strTitleProp];
					}
					this.parsePlaylistTracks();
				}
			}
		} catch (err) {
			this.log("error: " + err);
		}
	},

	_normalizeSongForView: function (song, index) {
		var clone = {};
		var prop;
		var trackNo = (song && song.trackNumber) ? song.trackNumber : (index + 1);
		for (prop in song) {
			if (song.hasOwnProperty(prop)) {
				clone[prop] = song[prop];
			}
		}
		clone.id = clone.id || clone._id || clone.path || "";
		clone.title = clone.title || clone.name || "";
		clone.artist = clone.artist || "";
		clone.album = clone.album || "";
		clone.artUrl = clone.artUrl || "";
		clone.trackNumber = trackNo;
		clone.playable = (clone.playable !== false);
		clone.origIndex = (song && song.origIndex !== undefined) ? song.origIndex : index;
		clone.thumbnails = clone.thumbnails || (clone.artUrl ? [{data: clone.artUrl}] : []);
		return clone;
	},

	parsePlaylistTracks: function () {
		var playlist;
		var arrPlaylistTrack;
		var intListTrack;
		var filtered = [];
		var song;
		if (this.arPlaylists[0]) {
			playlist = this.arPlaylists[0];
			arrPlaylistTrack = playlist[this.strTracksArrayName] || [];

			if (arrPlaylistTrack.length > 0) {
				for (intListTrack = 0; intListTrack < arrPlaylistTrack.length; intListTrack++) {
					song = this._normalizeSongForView(arrPlaylistTrack[intListTrack], intListTrack);
					if (this.searchQuery !== "") {
						if (enyo.g11n.Char.toUpper(" " + (song.artist || "")).indexOf(this.searchQuery) === -1 &&
							enyo.g11n.Char.toUpper(" " + (song.title || "")).indexOf(this.searchQuery) === -1) {
							continue;
						}
					}
					filtered.push(song);
				}

				this.arSongs = filtered;
				this._strListQuery = this.strPlaylistID + ":" + playlist.tracks.length + ":" + this.searchQuery;
				this.strSortMode = "position";
				this.boolSortAsc = true;

				if (this.arSongs.length > 0) {
					this.$.empty.hide();
					this.$.txtResults.hide();
					this.$.content.show();
					this.$.listMedia.punt();
				} else {
					this.$.content.hide();
					this.$.listMedia.punt();
					this.$.empty.show();
				}
			} else {
				this.arSongs = [];
				this.$.content.hide();
				this.$.listMedia.punt();
				this.$.empty.show();
			}

			if (this.$.ctrlListViewHeader) {
				this.$.ctrlListViewHeader.setIntHeaderCount(this.arSongs.length);
			}
			this.boolListRendered = true;
		}
	},

	updateSearchQuery: function (newSearch) {
		if (this.searchQuery !== newSearch) {
			this.strCurrListID = Utilities.generateGuid();
			this.searchQuery = newSearch;
			this.parsePlaylistTracks();
		}
	},

	onSearchSongs: function (sender, strSearch) {
		this.intJumpRowOffset = 0;
		this.arSongs = [];
		if (Utilities.fastTrim(strSearch) === "") {
			this.updateSearchQuery("");
			return;
		}
		this.updateSearchQuery(enyo.g11n.Char.toUpper(" " + enyo.string.trim(strSearch)));
		return true;
	},

	listSetupRow: function (inSender, intIndex) {
		var objSong;
		try {
			if (this.arSongs !== undefined && this.arSongs[intIndex] !== undefined) {
				objSong = this.arSongs[intIndex];
				this.$.songNumber.setContent(objSong.trackNumber || (intIndex + 1));
				this.$.songTitle.setContent(objSong.title);
				this.$.songArtist.setContent(objSong.artist);
				this.$.colDeleteItem.setShowing(this.boolEditMode);
				this.$.itemMedia.addRemoveClass("deleted", !!objSong.boolDeleted);
				this.handlePlayingSong(objSong, intIndex);
				this.$.itemMedia.addRemoveClass("odd", (intIndex % 2 === 0));
				return true;
			}
		} catch (err) {
			this.log("error: " + err);
		}
		return false;
	},

	handlePlayingSong: function (objSong, intIndex) {
		var first;
		var tempIndex;
		if (objSong.id === this.strCurrTrackID) {
			if (this.strCurrTrackListQuery === this._strListQuery + this.strSortMode) {
				if (objSong.origIndex === undefined) {
					for (tempIndex = 0; tempIndex < this.arSongs.length; tempIndex++) {
						this.arSongs[tempIndex].origIndex = tempIndex;
					}
				}
				this.$.itemMedia.addRemoveClass("playing", (this.intCurrTrackOrigIndex === objSong.origIndex));
				this.$.itemMedia.addRemoveClass("playingHere", (this.intCurrTrackOrigIndex === objSong.origIndex));
			} else {
				first = false;
				for (tempIndex = 0; tempIndex <= intIndex; tempIndex++) {
					if (tempIndex === intIndex) {
						first = true;
					}
					if (this.arSongs[tempIndex].id === objSong.id) {
						break;
					}
				}
				this.$.itemMedia.addRemoveClass("playing", first);
				this.$.itemMedia.removeClass("playingHere");
			}
		} else {
			this.$.itemMedia.removeClass("playingHere");
			this.$.itemMedia.removeClass("playing");
		}
	},

	onclick_Sort: function (objSender) {
		var boolNewSortAsc;
		try {
			this.log("onclick_Sort: " + objSender.name + " - " + this.boolSortAsc);
			this.log("curr sort mode " + this.strSortMode);

			switch (objSender.name) {
			case "lblSortArtist":
				boolNewSortAsc = this.strSortMode !== "artist" || (this.strSortMode === "artist" && !this.boolSortAsc);
				LibraryTools.sortbyArtist(this.arSongs, boolNewSortAsc);
				this.strSortMode = "artist";
				this.boolSortAsc = boolNewSortAsc;
				break;
			case "lblSortSong":
				boolNewSortAsc = this.strSortMode !== "title" || (this.strSortMode === "title" && !this.boolSortAsc);
				LibraryTools.sortbySong(this.arSongs, boolNewSortAsc);
				this.strSortMode = "title";
				this.boolSortAsc = boolNewSortAsc;
				break;
			case "lblSortPos":
				boolNewSortAsc = this.strSortMode !== "position" || (this.strSortMode === "position" && !this.boolSortAsc);
				LibraryTools.sortbyPos(this.arSongs, boolNewSortAsc);
				this.strSortMode = "position";
				this.boolSortAsc = boolNewSortAsc;
				break;
			}

			this.log("set to " + this.boolSortAsc);
			this.resetMusicListHeaders();
			objSender.addClass("sorted");
			objSender.addRemoveClass("asc", boolNewSortAsc);
			objSender.addRemoveClass("desc", !boolNewSortAsc);
			this.$.listMedia.refresh();
			this.strCurrListID = Utilities.generateGuid();
			this.doListChanged(this.arSongs, this.intCurrTrackOrigIndex);
		} catch (err) {
			this.log("**** onclick_Sort error: " + err);
		}
	},

	resetMusicListHeaders: function () {
		var intChildIndex;
		var header;
		for (intChildIndex = 0; intChildIndex < this.$.header.children.length; intChildIndex++) {
			header = this.$.header.children[intChildIndex];
			header.removeClass("desc");
			header.removeClass("asc");
			header.removeClass("sorted");
		}
	},

	clearPlaylist: function () {
		this.strPlaylistName = "";
		this.strPlaylistID = "";
		this.arPlaylists = [];
		this.arSongs = [];
		this.$.empty.hide();
		this.$.HeaderEdit.hide();
		this.$.ctrlListViewHeader.show();
		this.$.content.hide();
		this.$.footerEdit.hide();
		this.$.txtResults.hide();
		this.resetMusicListHeaders();
		this.$.ctrlListViewHeader.setStrHeaderTitle("");
		this.$.ctrlListViewHeader.setIntHeaderCount(-1);
		this.$.ctrlListViewHeader.setBoolShowEditPlaylist(false);
		this.$.ctrlListViewHeader.setBoolShowSearchBtn(false);
	},

	onclick_listMedia: function (sender, event) {
		var intClickIndex = event.rowIndex;
		var objSetPlaybackList;
		this.log(event.rowIndex);
		this.objPlaylist = this.arPlaylists[0];
		if (!this.boolEditMode && this.arSongs[intClickIndex]) {
			objSetPlaybackList = {
				arThumbnails: this.arSongs[intClickIndex].thumbnails,
				arSetPlaybackList: this.arSongs,
				intStartTrackIndex: intClickIndex,
				intStartTrackTime: 0,
				strOriginListID: this.strCurrListID,
				strListType: "Playlist",
				strListText: this.strPlaylistName,
				strPlaylistKind: this.strPlaylistKind,
				strListQuery: this._strListQuery + this.strSortMode,
				strPlaylistID: this.strPlaylistID
			};
			this.doSetPlaybackList(objSetPlaybackList);
		}
	},

	onStartEdit: function () {
		this.onEditMode(true);
		this.$.listMedia.refresh();
	},

	onCancelEdit: function () {
		var intClearIndex;
		this.onEditMode(false);
		for (intClearIndex = 0; intClearIndex < this.arSongs.length; intClearIndex++) {
			this.arSongs[intClearIndex].boolDeleted = false;
		}
		this.$.listMedia.refresh();
	},

	onDoneEdit: function () {
		this.log();
		if (this.processDeletedTracks(true)) {
			this.$.popupConfirmDone.openAtCenter();
		} else {
			this.closeEdit();
		}
	},

	onConfirmDone: function () {
		this.log();
		this.processDeletedTracks(false);
		this.closeEdit();
	},

	onCancelDone: function () {
		this.log();
		this.$.popupConfirmDone.close();
	},

	closeEdit: function () {
		this.$.popupConfirmDone.close();
		this.onEditMode(false);
		this.updatePlaylist();
	},

	onEditMode: function (boolEditMode) {
		this.log();
		this.boolEditMode = boolEditMode;
		this.doEditPlaylist(this.boolEditMode ? this.strPlaylistID : "");
		this.$.listMedia.addRemoveClass("editing", this.boolEditMode);
		if (this.boolEditMode) {
			this.$.HeaderEdit.show();
			this.$.ctrlListViewHeader.hide();
			this.$.footerEdit.show();
			this.$.txtPlaylistName.setValue(this.strPlaylistName);
		} else {
			this.$.HeaderEdit.hide();
			this.$.ctrlListViewHeader.show();
			this.$.footerEdit.hide();
		}
	},

	onclick_btnDeleteItem: function () {
		var intClickIndex = this.$.listMedia.fetchRowIndex();
		if (this.arSongs[intClickIndex]) {
			this.arSongs[intClickIndex].boolDeleted = !this.arSongs[intClickIndex].boolDeleted;
		}
		this.$.listMedia.refresh();
	},

	processDeletedTracks: function (boolCheckOnly) {
		var intOriginalTrackCount;
		var intIndex;
		var updatedTrack;
		this.log();
		if (boolCheckOnly === undefined) {
			boolCheckOnly = false;
		}
		this.arUpdateTracks = [];
		intOriginalTrackCount = this.arSongs.length;
		for (intIndex = this.arSongs.length - 1; intIndex >= 0; intIndex--) {
			if (boolCheckOnly) {
				if (this.arSongs[intIndex].boolDeleted) {
					return true;
				}
			} else {
				if (this.arSongs[intIndex].boolDeleted) {
					this.arSongs.splice(intIndex, 1);
				} else {
					updatedTrack = this._normalizeSongForView(this.arSongs[intIndex], 0);
					delete updatedTrack.boolDeleted;
					updatedTrack.trackNumber = this.arUpdateTracks.length + 1;
					this.arUpdateTracks.unshift(updatedTrack);
				}
			}
		}
		return this.arUpdateTracks.length !== intOriginalTrackCount;
	},

	updatePlaylist: function () {
		var edited = false;
		var objUpdatePlaylist;
		if (!this.arPlaylists[0]) {
			return;
		}
		if (this.arPlaylists[0].name !== this.$.txtPlaylistName.getValue()) {
			this.arPlaylists[0].name = this.$.txtPlaylistName.getValue();
			this.$.ctrlListViewHeader.setStrHeaderTitle(this.arPlaylists[0].name);
			this.strPlaylistName = this.$.txtPlaylistName.getValue();
			edited = true;
		}
		if (this.arPlaylists[0][this.strTracksArrayName].length !== this.arUpdateTracks.length) {
			this.$.ctrlListViewHeader.setIntHeaderCount(this.arUpdateTracks.length);
			this.arPlaylists[0][this.strTracksArrayName] = this.arUpdateTracks;
			edited = true;
		}
		if (edited) {
			this.log("this.arPlaylists[0]: ", this.arPlaylists[0]);
			objUpdatePlaylist = {objPlaylist: this.arPlaylists[0], callback: enyo.bind(this, "playlistUpdated")};
			this.doUpdatePlaylist(objUpdatePlaylist);
		}
	},

	playlistUpdated: function () {
		this.log();
		this.strCurrListID = Utilities.generateGuid();
		this.getPlaylist();
	},

	onclick_btnDeletePlaylist: function () {
		this.$.popupConfirmDelete.openAtCenter();
	},

	onConfirmDelete: function () {
		this.log();
		this.deletePlaylist();
		this.$.popupConfirmDelete.close();
	},

	onCancelDelete: function () {
		this.log();
		this.$.popupConfirmDelete.close();
	},

	deletePlaylist: function () {
		var objDeletePlaylist = {strPlaylistID: this.strPlaylistID};
		this.doDeletePlaylist(objDeletePlaylist);
	},

	playlistDeleted: function () {
		this.log();
		this.$.empty.hide();
		this.arSongs = [];
		this.$.listMedia.punt();
		this.clearPlaylist();
		this.$.txtResults.setContent($L("Playlist Deleted"));
		this.$.txtResults.show();
	},

	itemDragFinish: function (sender, event) {
		this.log();
		this.boolDraggingList = false;
		if (this.boolDragItem) {
			event.dragInfo.boolShowIcon = false;
			if (event.dragInfo.strPlaylistID) {
				var tempCallback = enyo.bind(this, function () {
					if (event.dragInfo.strPlaylistID === this.strPlaylistID) {
						this.renderList({strPlaylistName: this.strPlaylistName, strPlaylistID: this.strPlaylistID, strPlaylistKind: this.strPlaylistKind});
					}
				});
				this.callAddToPlaylist(event.dragInfo.dragItemIndex, event.dragInfo.strPlaylistID, "song", tempCallback);
			}
			this.$.listMedia.prepareRow(event.dragInfo.dragItemIndex);
			this.setItemHighlighted(false);
			this.doItemShowAvatarIcon(false);
			this.doItemShowAvatar(false);
			this.boolDragItem = false;
			this.dragObjType = null;
		}
	}
});