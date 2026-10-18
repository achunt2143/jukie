/*globals enyo, $L, JukieOffline, Utilities, window */
/*
 * kindListViewSaved - "Saved Offline": the songs the user chose to keep on the device
 * (JukieOffline.items, fed by app.js from the service's listOffline). Swipe a row sideways
 * for the stock Remove / Cancel prompt; confirming raises onToggleOffline, which app.js
 * already handles for a saved song by unpinning it (and deleting its audio).
 *
 * Deliberately NOT built on listViewDraggable: those rows use drag-to-playlist, and a
 * SwipeableItem's own drag handling would fight it (see enyo/CLAUDE.md). Tapping a row plays
 * it, with this list as the play queue, like the Songs list does.
 *
 * Presents the same view API app.js's setListViews expects: boolViewActive, renderList,
 * refreshList - plus repaintOfflineRows for the offline-state refresh.
 */
enyo.kind({
	name: "kindListViewSaved",
	kind: "VFlexBox",
	published: {boolViewActive: false},
	events: {onToggleOffline: "", onSetPlaybackList: ""},
	height: "100%",
	components: [
		{name: "ctrlListViewHeader", kind: "ctrlListViewHeader"},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "header", kind: "Control", layoutKind: "HFlexLayout", className: "divider first", align: "center", components: [
				{content: $L("Song"), flex: 2, className: "column sorted"},
				{content: $L("Artist"), flex: 1, className: "column"},
				{content: $L("Album"), flex: 1, className: "column"}
			]},
			{name: "list", kind: "VirtualList", flex: 1, onSetupRow: "listSetupRow", components: [
				{name: "itemSaved", kind: "SwipeableItem", layoutKind: "HFlexLayout", className: "song", confirmCaption: $L("Remove"), onConfirm: "onConfirmRemove", onclick: "onclick_item", components: [
					{name: "songTitle", flex: 2, className: "column title"},
					{name: "songArtist", flex: 1, className: "column artist"},
					{name: "songAlbum", flex: 1, className: "column album"},
					{name: "songOffline", kind: "Control", className: "column offlineBadge"}
				]}
			]}
		]},
		{name: "empty", kind: "Control", layoutKind: "VFlexLayout", align: "center", flex: 1, pack: "center", className: "empty", showing: false, components: [
			{kind: "Control", className: "content", components: [
				{content: $L("No songs are saved for offline play."), className: "heading"},
				{content: $L("Tap the arrow at the end of a song to save it.")}
			]}
		]}
	],

	arSongs: [],
	strCurrListID: "",

	create: function () {
		this.inherited(arguments);
		this.strCurrListID = Utilities.generateGuid();
		this.$.ctrlListViewHeader.setStrHeaderTitle($L("Saved Offline"));
		this.$.ctrlListViewHeader.setBoolShowSearchBtn(false);
	},

	// Rebuild the rows from the shared offline state. Songs the user just removed are gone
	// from JukieOffline.saved at once (optimistic), even before the service confirms.
	_loadSongs: function () {
		var items = JukieOffline.items || [];
		var songs = [];
		var i, it;
		for (i = 0; i < items.length; i++) {
			it = items[i];
			if (!it || !it.id || !JukieOffline.saved[it.id]) { continue; }
			songs.push({
				id: it.id,
				title: it.title || "",
				artist: it.artist || "",
				album: it.album || "",
				durationMs: 0,
				artUrl: it.artUrl || "",
				arThumbnails: it.artUrl ? [{data: it.artUrl}] : [],
				libraryId: it.libraryId || "",
				playable: true
			});
		}
		songs.sort(function (a, b) {
			var x = a.title.toLowerCase(), y = b.title.toLowerCase();
			return x < y ? -1 : (x > y ? 1 : 0);
		});
		this.arSongs = songs;
		this.$.ctrlListViewHeader.setIntHeaderCount(songs.length);
		this.$.empty.setShowing(songs.length === 0);
		this.$.content.setShowing(songs.length > 0);
	},

	// app.js calls refreshList when this view is first switched to and renderList when it is
	// already showing (a song change, a library sync), so only the former resets the scroll.
	refreshList: function () {
		this._loadSongs();
		if (this.arSongs.length) {
			this.$.list.punt();
		}
	},

	renderList: function () {
		this.repaintOfflineRows();
	},

	// Called from app.js when the offline state changes (a download finished, a song was
	// removed from another list, ...). Keeps the scroll position.
	repaintOfflineRows: function () {
		this._loadSongs();
		if (this.arSongs.length) {
			this.$.list.refresh();
		}
	},

	listSetupRow: function (sender, index) {
		var s = this.arSongs[index];
		if (!s) { return false; }
		JukieEmoji.setContent(this.$.songTitle, s.title);
		JukieEmoji.setContent(this.$.songArtist, s.artist);
		JukieEmoji.setContent(this.$.songAlbum, s.album);
		var st = JukieOffline.state(s.id);
		this.$.songOffline.addRemoveClass("saved", st === "saved");
		this.$.songOffline.addRemoveClass("pending", st === "pending");
		this.$.songOffline.addRemoveClass("cached", st === "cached");
		this.$.itemSaved.addRemoveClass("unavailable", JukieOffline.isUnavailable(s.id));
		return true;
	},

	onConfirmRemove: function (sender, index) {
		var s = this.arSongs[index];
		if (s) {
			this.doToggleOffline(s);
		}
		this.repaintOfflineRows();
	},

	onclick_item: function (sender, event) {
		var index = event.rowIndex;
		var s = this.arSongs[index];
		if (!s) { return; }
		if (JukieOffline.isUnavailable(s.id)) {
			enyo.windows.addBannerMessage($L("Not available offline"), "{}", "images/notification-small.png");
			return;
		}
		this.doSetPlaybackList({
			arThumbnails: s.arThumbnails,
			arSetPlaybackList: this.arSongs,
			intStartTrackIndex: index,
			intStartTrackTime: 0,
			strOriginListID: this.strCurrListID,
			strListType: "Song",
			strListText: s.title,
			strListSubText: s.artist,
			strListQuery: "saved-offline"
		});
	}
});
