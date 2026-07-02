/*globals enyo, $L, event, Utilities, window */
enyo.kind({
	name: "KindAlbumArtItem",
	kind: "Control",
	layoutKind: "VFlexLayout",
	className: "item focused",
	events: {onItemClick: ""},
	published: {
		intTrackOrigIndex: -99,
		intTrackIndex: -98,
		strArtistName: "",
		strSongTitle: "",
		strAlbumName: "",
		strAlbumArtFile: "",
		intCurrTrackIndex: -100,
		boolAudioPlaying: true,
		boolShow: true,
		boolVertical: true
	},
	components: [
		{name: "itemHeader", className: "info", kind: "Control", pack: "end", showing: true, components: [
			{name: "lblSongTitle", content: "", className: "album"},
			{name: "lblArtistName", content: "", className: "artist"},
			{name: "imgMusicNote", kind: "Image", src: "images/Music_Note_white.png", className: "indicator"},
			{name: "lblAlbumName", content: "", className: "title"}
		]},
		{name: "albumArtContainer", className: "cover", onclick: "onclick_vfbItem", components: [
			{name: "imgAlbumArt", kind: "Control", className: "img"},
			{name: "imgAlbumArtIcon", kind: "Image", src: "images/play_albumartitem.png", className: "albumarticon", showing: false}
		]}
	],

	create: function () {
		try {
			this.inherited(arguments);
			this.setupObj();
			this.checkIfCurrentTrack();
		} catch (err2) {
			this.log("error: ", err2);
		}
	},

	destroy: function () {
		this._clearIconFadeTimer();
		this.inherited(arguments);
	},

	_clearIconFadeTimer: function () {
		if (this.iconFadeTimer) {
			window.clearTimeout(this.iconFadeTimer);
			this.iconFadeTimer = null;
		}
	},

	_artUrl: function () {
		return this.strAlbumArtFile || "";
	},

	setupObj: function () {
		var artUrl = this._artUrl();
		this.$.lblSongTitle.setContent(this.strSongTitle);
		this.$.lblArtistName.setContent(this.strArtistName);
		this.$.lblAlbumName.setContent(this.strAlbumName);
		this.log("**** ", artUrl);

		if (this.boolShow) {
			if (artUrl !== "") {
				try {
					this.$.imgAlbumArt.show();
					this.$.imgAlbumArt.setStyle("background-image: url('" + artUrl + "');");
					this.$.albumArtContainer.addClass("albumartbg");
				} catch (err) {
					this.log("image error: ", err);
					this.$.imgAlbumArt.hide();
				}
			} else {
				this.log("setting missing image");
				this.$.imgAlbumArt.hide();
			}
		} else {
			this.log("setting blank image");
			this.$.albumArtContainer.hide();
		}
	},

	onImgError: function (sender, event) {
		this.log();
		this.log(sender);
	},

	checkIfCurrentTrack: function (boolAudioPlaying, intCurrTrackIndex) {
		this.log();
		this.log("intCurrTrackIndex: ", intCurrTrackIndex);
		this.log("boolAudioPlaying: ", boolAudioPlaying);

		var boolWasPlaying = this.boolAudioPlaying;
		var boolStateChanged = false;

		if (boolAudioPlaying !== undefined) {
			boolStateChanged = (boolAudioPlaying !== boolWasPlaying);
			this.boolAudioPlaying = boolAudioPlaying;
		}

		if (intCurrTrackIndex !== undefined) {
			this.intCurrTrackIndex = intCurrTrackIndex;
		}

		this.$.imgMusicNote.setShowing(this.intTrackIndex === this.intCurrTrackIndex);

		// Keep the play/pause icon in sync with the REAL playback state (paused/resumed via
		// the main player controls, hardware media keys, etc - not just a tap on THIS card).
		// Only for the card that's actually the current track - other cards don't represent
		// live playback state, so they shouldn't show a play/pause icon at all.
		if (boolStateChanged && this.intTrackIndex === this.intCurrTrackIndex) {
			this.setPlayPauseIcon();
		}
	},

	setPlayPauseIcon: function () {
		this.log();
		if (this.boolAudioPlaying) {
			this.$.imgAlbumArtIcon.setSrc("images/play_albumartitem.png");
		} else {
			this.$.imgAlbumArtIcon.setSrc("images/pause_albumartitem.png");
		}
		this.$.imgAlbumArtIcon.applyStyle("opacity", null);
		this.$.imgAlbumArtIcon.show();
		this._clearIconFadeTimer();
		if (this.boolAudioPlaying) {
			// Now playing: flash the "play" glyph as a brief confirmation, then fade out -
			// once audio is actually playing that's its own ongoing indicator, so the icon
			// doesn't need to stick around.
			var self = this;
			this.iconFadeTimer = window.setTimeout(function () {
				self.iconFadeTimer = null;
				self.$.imgAlbumArtIcon.applyStyle("opacity", "0");
				window.setTimeout(function () {
					self.$.imgAlbumArtIcon.hide();
				}, 300);
			}, 1000);
		}
		// Paused: show the "pause" glyph and keep it showing - there's no audio cue for
		// "paused", so this icon is the only indicator and needs to persist.
	},

	displayAsCurrent: function () {
		try {
			this.log(this.strSongTitle);
			this.addRemoveClass("focused", true);
		} catch (err) {
			this.log(err);
		}
	},

	displayAsPrev: function () {
		this.log("");
		this.addRemoveClass("focused", false);
	},

	displayAsNext: function () {
		this.log("");
		this.addRemoveClass("focused", false);
	},

	onclick_vfbItem: function () {
		try {
			this.log();
			this.boolAudioPlaying = !this.boolAudioPlaying;
			this.setPlayPauseIcon();
			this.doItemClick(this.intTrackOrigIndex);
		} catch (err) {
			this.log("error: ", err);
		}
	}
});