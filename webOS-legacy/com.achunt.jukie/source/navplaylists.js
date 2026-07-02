/*globals enyo, $L, event, Utilities, window */
enyo.kind({
	name: "navplaylists",
	kind: "Control",
	flex: 1,
	events: {onRequestPlaylists: "", onClickPlaylist: "", onCreatePlaylist: "", onDeletePlaylist: ""},
	published: {strEditPlaylistID: "", strSelectedPlaylistID: "", strSelectedPlaylistFile: ""},
	components: [
		{name: "txtResults"},
		{name: "listPlaylists", kind: "VirtualList", onSetupRow: "listSetupRow", height: "52px", onclick: "onClick_listPlaylists", components: [
			{name: "itemPlaylist", kind: "SwipeableItem", onConfirm: "onclick_btnDelete", className: "playlist", layoutKind: "HFlexLayout", pack: "justify", align: "center", confirmCaption: $L("Delete"), ondragover: "dragOver", ondrop: "dragDrop", ondragout: "dragOut", components: [
				{name: "iconPlaylist", className: "icon"},
				{name: "playlistName", content: $L("My Playlist"), className: "name", flex: 1}
			]}
		]},
		{name: "popNewPlaylist", kind: "ModalDialog", onOpen: "onOpen_PopNewPlaylist", onClose: "onClose_PopNewPlaylist", caption: $L("New Playlist"), showKeyboardWhenOpening: true, components: [
			{name: "txtPlaylistName", kind: "Input", hint: $L("Type Playlist Name"), autocorrect: false, spellcheck: false, style: "margin:13px 0;", onkeypress: "onkeypress_txtPlaylistName"},
			{kind: "Control", layoutKind: "HFlexLayout", components: [
				{kind: "Button", flex: 1, caption: $L("Cancel"), onclick: "onclick_Cancel"},
				{kind: "Button", flex: 1, caption: $L("Create"), onclick: "onclick_Create"}
			]}
		]}
	],

	ROW_HEIGHT: 52,
	intJumpRowOffset: 1,
	_strNewPlaylistID: null,
	arPlaylists: null,
	strCurrentRequestID: "",

	create: function () {
		this.inherited(arguments);
		this.arPlaylists = [];
	},

	ready: function () {
		try {
		} catch (err) {
			this.log("**** ready error: " + err);
		}
	},

	renderList: function () {
		this.log();
		this.arPlaylists = [];
		this.strCurrentRequestID = Utilities.generateGuid();
		this.intJumpRowOffset = 1;
		this.getPlaylists();
	},

	refreshList: function () {
		this.$.listPlaylists.refresh();
	},

	scrollerScroll: function (scrollTo) {
		var pageSize = this.$.listPlaylists.getPageSize();
		this.$.listPlaylists.$.scroller.adjustTop(scrollTo);
		this.$.listPlaylists.$.scroller.adjustBottom(scrollTo + pageSize);
		this.$.listPlaylists.$.scroller.top = scrollTo;
		this.$.listPlaylists.$.scroller.bottom = scrollTo + pageSize;
	},

	getPlaylists: function () {
		var objGetPlaylistsRequest = {
			where: [],
			playlistKind: "applemusic",
			callback: enyo.bind(this, "gotPlaylists"),
			strCurrentRequestID: this.strCurrentRequestID
		};

		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetPlaylistsRequest);
		this.doRequestPlaylists(objGetPlaylistsRequest);
	},

	gotPlaylists: function (inResponse, inRequest) {
		var request = inRequest && (inRequest.objGetPlaylistsRequest || inRequest);
		var results;
		var intCheckIndex;
		try {
			results = (inResponse && inResponse.results) ? inResponse.results : [];

			if (request && this.strCurrentRequestID === request.strCurrentRequestID) {
				this.arPlaylists = results.slice(0);
			} else if (!request) {
				this.arPlaylists = results.slice(0);
			}

			this.log("this.arPlaylists.length: " + this.arPlaylists.length);

			for (intCheckIndex = 0; intCheckIndex < this.arPlaylists.length; intCheckIndex++) {
				if (this.arPlaylists[intCheckIndex].id === this._strNewPlaylistID || this.arPlaylists[intCheckIndex].id === this.strSelectedPlaylistID) {
					this.log("intCheckIndex matched: " + intCheckIndex);
					this.intJumpRowOffset = Math.max(1, intCheckIndex);
				}
			}

			this.resize(Math.max(1, this.arPlaylists.length) * this.ROW_HEIGHT);
			this.$.listPlaylists.resized();
			// At this list's small/dynamic height the framework's scroller can fall back to
			// a plain enyo.VirtualRepeater internally, which has no punt() (full reset) -
			// only refresh(). Use punt() when available for a proper reset (row count just
			// changed), otherwise fall back to refresh() so this never throws.
			if (typeof this.$.listPlaylists.punt === "function") {
				this.$.listPlaylists.punt();
			} else {
				this.$.listPlaylists.refresh();
			}
		} catch (err) {
			this.log("error: " + err);
		}
	},

	listSetupRow: function (inSender, intIndex) {
		var playlist;
		try {
			intIndex = intIndex + this.intJumpRowOffset - 1;
			if (this.arPlaylists !== undefined) {
				playlist = this.arPlaylists[intIndex];
				if (playlist !== undefined) {
					this._strNewPlaylistID = null;
					this.$.itemPlaylist.addRemoveClass("enyo-first", (intIndex < 1));
					this.$.itemPlaylist.addRemoveClass("active", (playlist.id === this.strSelectedPlaylistID));
					this.$.playlistName.setContent(playlist.name || playlist.title || "");
					this.$.itemPlaylist.addRemoveClass("readonly", !!playlist.readonly);
					this.$.itemPlaylist.addRemoveClass("editing", (playlist.id === this.strEditPlaylistID));
					return true;
				}
			}
		} catch (err) {
			this.log(err);
		}
		return false;
	},

	clearSelection: function () {
		this.setStrSelectedPlaylistID("");
		this.setStrSelectedPlaylistFile("");
		this.setStrEditPlaylistID("");
	},

	onClick_listPlaylists: function (sender, event) {
		var intIndex = event.rowIndex + this.intJumpRowOffset - 1;
		var playlist;
		this.log(event.rowIndex);

		if (intIndex !== undefined && this.arPlaylists[intIndex]) {
			playlist = this.arPlaylists[intIndex];
			if (playlist.id !== this.strEditPlaylistID) {
				this.strEditPlaylistID = "";
				this.log("this.arPlaylists[" + intIndex + "]: " + playlist);
				this.goToPlaylist({
					strPlaylistName: playlist.name || playlist.title || "",
					strPlaylistID: playlist.id,
					strPlaylistKind: playlist.kind || "applemusic"
				});
			}
		}
	},

	goToPlaylist: function (objPlaylist, forceRender) {
		this.setStrSelectedPlaylistID(objPlaylist.strPlaylistID);
		this.setStrSelectedPlaylistFile("");
		if (forceRender) {
			this.renderList();
		} else {
			this.refreshList();
		}
		this.doClickPlaylist(objPlaylist);
	},

	strEditPlaylistIDChanged: function () {
		this.log();
		this.refreshList();
	},

	strSelectedPlaylistFileChanged: function () {
		this.log();
		this.refreshList();
	},

	ShowPopNewPlaylist: function () {
		this.$.popNewPlaylist.openAtCenter();
	},

	onOpen_PopNewPlaylist: function () {
		this.$.txtPlaylistName.forceFocus();
		enyo.keyboard.setManualMode(false);
	},

	onClose_PopNewPlaylist: function () {
		this.$.txtPlaylistName.forceBlur();
		enyo.keyboard.hide();
		enyo.keyboard.setManualMode(false);
	},

	onkeypress_txtPlaylistName: function (sender, event) {
		this.log(event.keyCode);
		if (event.keyCode === 13) {
			this.onclick_Create();
		}
	},

	onclick_Create: function () {
		if (Utilities.fastTrim(this.$.txtPlaylistName.getValue()) !== "") {
			var strNewPlaylistName = this.$.txtPlaylistName.getValue();
			var objPutPlaylistsRequest = {strPlaylistName: strNewPlaylistName, callback: enyo.bind(this, "onSuccess_GoToPlaylist", strNewPlaylistName)};
			this.$.txtPlaylistName.setValue("");
			this.$.popNewPlaylist.close();
			this.doCreatePlaylist(objPutPlaylistsRequest);
		}
	},

	onSuccess_GoToPlaylist: function (strPlaylistName, strPlaylistID) {
		this._strNewPlaylistID = strPlaylistID;
		this.renderList();
	},

	onclick_Cancel: function () {
		this.$.txtPlaylistName.setValue("");
		this.$.popNewPlaylist.close();
	},

	onclick_btnDelete: function (sender, intIndex) {
		intIndex += this.intJumpRowOffset - 1;
		if (intIndex !== undefined && this.arPlaylists[intIndex]) {
			var objDeletePlaylist = {strPlaylistID: this.arPlaylists[intIndex].id};
			this.clearSelection();
			this.doDeletePlaylist(objDeletePlaylist);
		}
	},

	dragOver: function (inSender, event) {
		var playlist;
		if (event.dragInfo !== undefined) {
			playlist = this.arPlaylists[event.rowIndex + this.intJumpRowOffset - 1];
			if (playlist && !playlist.readonly) {
				inSender.addClass("editing");
				event.dragInfo.boolShowIcon = true;
			} else {
				event.dragInfo.boolShowIcon = false;
			}
		}
	},

	dragOut: function (inSender, event) {
		if (event.dragInfo !== undefined) {
			inSender.removeClass("editing");
			event.dragInfo.boolShowIcon = false;
		}
	},

	dragDrop: function (inSender, event) {
		var intIndex;
		var playlist;
		this.log();
		this.log(inSender);
		if (event.dragInfo !== undefined) {
			inSender.removeClass("editing");
			intIndex = event.rowIndex + this.intJumpRowOffset - 1;
			playlist = this.arPlaylists[intIndex];
			if (playlist && !playlist.readonly) {
				event.dragInfo.strPlaylistName = playlist.name || playlist.title || "";
				event.dragInfo.strPlaylistID = playlist.id;
			}
		}
	},

	resize: function (intContentHeight) {
		this.$.listPlaylists.applyStyle("height", intContentHeight + "px");
		this.resized();
	}
});