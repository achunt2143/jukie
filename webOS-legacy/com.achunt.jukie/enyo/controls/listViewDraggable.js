/*globals enyo, $L, event, Utilities, window */
enyo.kind({
	name: "draggableItem",
	kind: "Item",
	onmouserelease: "itemMouserelease", ondragstart: "itemDragStart", ondragfinish: "itemDragFinish", ondrag: "onDrag_itemMedia", ondrop: "onDrop_itemMedia"
});

enyo.kind({
	name: "draggableSong",
	kind: "draggableItem",
	onmousehold: "songMousehold"
});

enyo.kind({
	name: "draggableAlbum",
	kind: "draggableItem",
	onmousehold: "albumMousehold"
});

enyo.kind({
	name: "draggableAlbumGroup",
	kind: "draggableItem",
	onmousehold: "albumGroupMousehold"
});

enyo.kind({
	name: "draggableArtist",
	kind: "draggableItem",
	onmousehold: "artistMousehold"
});

enyo.kind({
	name: "draggableGenre",
	kind: "ItemGrid",
	onmousehold: "genreMousehold", onmouserelease: "itemMouserelease", ondragstart: "itemDragStart", ondragfinish: "itemDragFinish", ondrag: "onDrag_itemMedia", ondrop: "onDrop_itemMedia"
});

enyo.kind({
	name: "listViewDraggable",
	kind: "listView",
	events: {onAddToPlaylist: "", onItemDrag: "", onItemShowAvatar: "", onItemShowAvatarIcon: "", onToggleOffline: ""},
	intJumpRowOffset: 0,
	boolDragHold: false,
	boolDragItem: false,
	boolDraggingList: false,
	dragObjType: null,
	arItems: [],
	albumGroup: false,
	scrolling: false,

	create: function () {
		this.inherited(arguments);
	},

	ready: function () {
		this.inherited(arguments);
		if (this.$.listMedia) {
			this.$.listMedia.$.scroller.scrollStop = enyo.bind(this, function () { this.setScrolling(false); });
			this.$.listMedia.$.scroller.scrollStart = enyo.bind(this, function () { this.setScrolling(true); });
		}
	},

	setScrolling: function (bool) {
		this.scrolling = bool;
	},

	setPlayingStyles: function (id, itemMedia, strListQuery) {
		if (id === this.strCurrTrackID) {
			itemMedia.addRemoveClass("playingHere", (this.strCurrTrackListQuery === strListQuery));
			itemMedia.addClass("playing");
		} else {
			itemMedia.removeClass("playingHere");
			itemMedia.removeClass("playing");
		}
	},

	// ---- saved-for-offline support for song rows (see utility/offline.js) ----

	// Called from listSetupRow, which runs on every row recycle while scrolling - so this is
	// only cheap lookups on JukieOffline's plain objects. `badge` is the row's tappable
	// download glyph (named songOffline in the song-row lists).
	paintOfflineRow: function (objSong, itemMedia, badge) {
		var st = JukieOffline.state(objSong && objSong.id);
		if (badge) {
			badge.addRemoveClass("saved", st === "saved");
			badge.addRemoveClass("pending", st === "pending");
			badge.addRemoveClass("cached", st === "cached");
		}
		itemMedia.addRemoveClass("unavailable", JukieOffline.isUnavailable(objSong && objSong.id));
	},

	// Tapping the badge saves/removes the song; the app does the work (onToggleOffline).
	// Returns true so the click doesn't also bubble to the row and start playback.
	onclick_offlineBadge: function (sender, event) {
		var objSong = this.arSongs && this.arSongs[this.getDragIndex(sender, event)];
		if (objSong && objSong.id) {
			this.doToggleOffline(objSong);
		}
		return true;
	},

	// Offline and not on the device -> tell the user instead of starting a doomed fetch.
	blockIfUnavailable: function (objSong) {
		if (objSong && JukieOffline.isUnavailable(objSong.id)) {
			enyo.windows.addBannerMessage($L("Not available offline"), "{}", "images/notification-small.png");
			return true;
		}
		return false;
	},

	// Repaint the visible rows in place (scroll position kept) after an offline-state change.
	repaintOfflineRows: function () {
		if (this.$.listMedia && this.$.listMedia.refresh) {
			this.$.listMedia.refresh();
		}
	},

	callAddToPlaylist: function (intIndex, strPlaylistID, addType, callback) {
		var objAddToPlaylist;
		var objItem = this.arItems[intIndex];
		this.log();
		switch (addType) {
		case "album":
			if (this.albumGroup) {
				objAddToPlaylist = {strMediaType: "album", strMediaFilter: objItem.name, strMediaFilterSub: objItem.artist, strPlaylistID: strPlaylistID};
			} else {
				objAddToPlaylist = {strMediaType: "album", strMediaFilter: objItem.album, strMediaFilterSub: objItem.albumArtist || objItem.artist, strPlaylistID: strPlaylistID, callback: callback};
			}
			break;
		case "artist":
		case "genre":
			objAddToPlaylist = {strMediaType: addType, strMediaFilter: objItem.name, strPlaylistID: strPlaylistID};
			break;
		default:
			objAddToPlaylist = {strMediaType: "song", arTracks: [Utilities.getPlaylistSongData(objItem)], strPlaylistID: strPlaylistID, callback: callback};
			break;
		}
		this.log("**** raising doAddToPlaylist for clicked song");
		this.doAddToPlaylist(objAddToPlaylist);
	},

	songMousehold: function (sender, event) {
		this.dragObjType = "song";
		this.arItems = this.arSongs;
		this.itemMousehold(sender, event);
	},

	albumMousehold: function (sender, event) {
		this.dragObjType = "album";
		this.arItems = this.arSongs;
		this.albumGroup = false;
		this.itemMousehold(sender, event);
	},

	albumGroupMousehold: function (sender, event) {
		this.dragObjType = "album";
		this.arItems = this.arAlbums;
		this.albumGroup = true;
		this.itemMousehold(sender, event);
	},

	artistMousehold: function (sender, event) {
		this.dragObjType = "artist";
		this.arItems = this.arArtists;
		this.itemMousehold(sender, event);
	},

	genreMousehold: function (sender, event) {
		this.dragObjType = "genre";
		this.arItems = this.arGenres;
		this.itemMousehold(sender, event);
	},

	_resolveDragThumb: function (objItem) {
		if (!objItem) {
			return "";
		}
		if (objItem.artUrl) {
			return Utilities.artworkUrl(objItem.artUrl, 88);
		}
		if (objItem.artwork) {
			return Utilities.artworkUrl(objItem.artwork, 88);
		}
		if (objItem.thumbnails) {
			return Utilities.getItemThumb(objItem.thumbnails, 88).strThumbURL;
		}
		return "";
	},

	itemMousehold: function (sender, event) {
		var intDragIndex;
		var strDragThumb = "";
		var objItem;
		this.log();
		if (this.boolEditMode === undefined) {
			this.boolEditMode = false;
		}
		if (this.boolEditMode || this.scrolling) {
			return false;
		}
		intDragIndex = this.getDragIndex(sender, event);
		this.setItemHighlighted(true);
		objItem = this.arItems[intDragIndex];
		if (objItem && window.PalmSystem) {
			strDragThumb = this._resolveDragThumb(objItem);
		}
		this.boolDragHold = true;
		this.doItemDrag(event);
		this.doItemShowAvatar(true, strDragThumb);
		return false;
	},

	itemMouserelease: function () {
		this.log();
		if (!this.boolDragItem) {
			this.setItemHighlighted(false);
			this.doItemShowAvatar(false);
			this.dragObjType = null;
		}
		this.boolDragHold = false;
		return true;
	},

	itemDragStart: function (sender, event) {
		var intDragIndex;
		var objItem;
		if (this.boolDragHold && !this.boolEditMode) {
			intDragIndex = this.getDragIndex(sender, event);
			objItem = this.arItems[intDragIndex];
			if (objItem === undefined) {
				this.log("Given an invalid dragIndex");
				this.itemMouserelease();
				return;
			}
			this.boolDraggingList = true;
			this.boolDragItem = true;
			switch (this.dragObjType) {
			case "song":
				event.dragInfo = {dragItemIndex: intDragIndex, addType: "song", addTitle: objItem.title};
				break;
			case "album":
				if (this.albumGroup) {
					event.dragInfo = {dragItemIndex: intDragIndex, addType: "album", addTitle: objItem.name, boolShowIcon: false};
				} else {
					event.dragInfo = {dragItemIndex: intDragIndex, addType: "album", addTitle: objItem.album, boolShowIcon: false};
				}
				break;
			case "artist":
				event.dragInfo = {dragItemIndex: intDragIndex, addType: "artist", addTitle: objItem.name, boolShowIcon: false};
				break;
			case "genre":
				event.dragInfo = {dragItemIndex: intDragIndex, addType: "genre", addTitle: objItem.name, boolShowIcon: false};
				break;
			}
			this.setItemHighlighted(true);
			this.doItemDrag(event);
			return true;
		}
	},

	onDrag_itemMedia: function (sender, event) {
		if (event.dragInfo) {
			this.doItemShowAvatarIcon(event.dragInfo.boolShowIcon);
		}
		if (this.boolDragItem) {
			this.doItemDrag(event);
		}
	},

	itemDragFinish: function (sender, event) {
		this.log();
		this.boolDraggingList = false;
		if (this.boolDragItem) {
			event.dragInfo.boolShowIcon = false;
			if (event.dragInfo.strPlaylistID) {
				this.callAddToPlaylist(event.dragInfo.dragItemIndex, event.dragInfo.strPlaylistID, event.dragInfo.addType);
			}
			if (this.dragObjType === "genre") {
				this.$.listMedia.prepareRow(Math.floor(event.dragInfo.dragItemIndex / this.intColumns));
			} else {
				this.$.listMedia.prepareRow(event.dragInfo.dragItemIndex);
			}
			this.setItemHighlighted(false);
			this.doItemShowAvatarIcon(false);
			this.doItemShowAvatar(false);
			this.boolDragItem = false;
			this.dragObjType = null;
		}
	},

	setItemHighlighted: function (inHighlight) {
		if (this.$.itemMedia) {
			this.$.itemMedia.addRemoveClass("selected", inHighlight);
		}
	},

	onDrop_itemMedia: function (sender, event) {
		this.log(event.keys);
		if (this.boolDraggingList) {
			this.boolSuspendClick = true;
		}
		return true;
	},

	getDragIndex: function (sender, event) {
		if (this.dragObjType === "genre") {
			return (event.rowIndex * this.intColumns) + sender.intColumnIndex;
		}
		return event.rowIndex + this.intJumpRowOffset;
	}
});