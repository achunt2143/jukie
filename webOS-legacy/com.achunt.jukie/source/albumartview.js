/*globals enyo, $L, event, Utilities, window */
enyo.kind({
	name: "ScrollTracks",
	kind: enyo.SnapScroller,
	dragstartHandler: function (inSender, e) {
		if (this.dragging || this.snapping) {
			return true;
		}
		return this.inherited(arguments);
	},
	dragHandler: function (inSender, e) {
		if (this.snapping) {
			return true;
		}
		return this.inherited(arguments);
	},
	flickHandler: function (inSender, e) {
		if (this.snapping) {
			return true;
		}
		return this.inherited(arguments);
	}
});

enyo.kind({
	name: "KindAlbumArtView",
	kind: "Control",
	className: "flow",
	events: {onRequestTracks: "", onClickAlbumArtView: ""},
	components: [
		{name: "scrollTracks", kind: "ScrollTracks", className: "scrollH", layoutKind: "HFlexLayout", autohorizontal: true, horizontal: true, autovertical: false, vertical: false, onSnap: "onSnap_scrollTracks", onSnapFinish: "onSnapFinish_scrollTracks", onScrollStart: "onScrollStart_scrollTracks", onScrollStop: "onScrollStop_scrollTracks", showing: true},
		{kind: "Control", name: "shadowMask", className: "mask", style: "-webkit-palm-mouse-target:ignore;"}
	],

	_arFullTrackList: [],
	intCurrSnapPos: 0,
	intCurrListMin: 0,
	intCurrListMax: 0,
	intCurrListIndex: 0,
	boolGotTracks: false,
	boolScrollerDrawn: false,
	intCurrTrackIndex: -1,
	boolAudioPlaying: false,
	boolUpdateScroller: false,
	boolLandscape: true,

	create: function () {
		this.inherited(arguments);
		this.index = 1;
	},

	_getScrollerItems: function () {
		var container = this.$.scrollTracks.children && this.$.scrollTracks.children[0];
		return container && container.children ? container.children : [];
	},

	_getSnapItem: function (offset) {
		var items = this._getScrollerItems();
		var index = this.intCurrSnapPos + offset;
		if (index >= 0 && index < items.length) {
			return items[index];
		}
		return null;
	},

	_trackArtUrl: function (objTrack) {
		if (!objTrack) {
			return "";
		}
		return objTrack.artUrl || objTrack.strTrackImage || "";
	},

	orientationChanged: function (boolLandscape) {
		this.log(boolLandscape);
		if (this.boolLandscape !== boolLandscape) {
			if (boolLandscape) {
				this.$.scrollTracks.setClassName("scrollH");
			} else {
				this.$.scrollTracks.setClassName("scrollV");
			}
			this.boolLandscape = boolLandscape;
		}
	},

	populateScroller: function (intCurrTrackIndex) {
		var intInitialSnapIndex;
		var ctrlAlbumArtItem;
		var intCheckPos;
		var objTrack;
		this.log(intCurrTrackIndex);
		this.intCurrListIndex = intCurrTrackIndex;
		this.intCurrListMin = Math.max(intCurrTrackIndex - 6, -1);
		intInitialSnapIndex = intCurrTrackIndex - this.intCurrListMin - 1;
		this.clearScroller();

		for (intCheckPos = this.intCurrListMin; intCheckPos <= intCurrTrackIndex + 6; intCheckPos++) {
			ctrlAlbumArtItem = null;
			if (intCheckPos < 0 || intCheckPos >= this._arFullTrackList.length) {
				if (intCheckPos <= intCurrTrackIndex + 3 && intCheckPos <= this._arFullTrackList.length + 1) {
					ctrlAlbumArtItem = this.$.scrollTracks.createComponent({kind: "KindAlbumArtItem", boolShow: false}, {owner: this});
				}
			} else {
				objTrack = this._arFullTrackList[intCheckPos];
				if (objTrack !== undefined) {
					this.log("Adding Album Art: ", this._trackArtUrl(objTrack));
					// {owner: this} is required here - createComponent() defaults owner to
					// whatever it's CALLED ON (scrollTracks), not the kind calling it
					// (KindAlbumArtView). Without it, "onItemClick: doClickAlbumArtView"
					// resolves against scrollTracks (which has no such method) and silently
					// never fires - this was why tapping album art did nothing at all.
					ctrlAlbumArtItem = this.$.scrollTracks.createComponent({
						kind: "KindAlbumArtItem",
						intTrackOrigIndex: (objTrack.origIndex !== undefined) ? objTrack.origIndex : intCheckPos,
						strSongTitle: objTrack.title || "",
						strAlbumArtFile: this._trackArtUrl(objTrack),
						strArtistName: objTrack.artist || "",
						strAlbumName: objTrack.album || "",
						onItemClick: "doClickAlbumArtView",
						intCurrTrackIndex: this.intCurrTrackIndex,
						boolAudioPlaying: this.boolAudioPlaying,
						intTrackIndex: intCheckPos,
						boolVertical: this.boolLandscape
					}, {owner: this});
				}
			}
		}

		try {
			this.$.scrollTracks.render();
			this.$.scrollTracks.contentChanged();
			this.boolUpdateScroller = false;
			this.intCurrSnapPos = intInitialSnapIndex;
			this.$.scrollTracks.setIndex(this.intCurrSnapPos);
			this.boolScrollerDrawn = true;
		} catch (err) {
			this.log("err: ", err);
		}
	},

	setScrollerIndex: function () {
		this.$.scrollTracks.setIndex(5);
	},

	onclickAlbumArtItemTest: function () {
		this.log();
		this.doClickAlbumArtView();
	},

	clearScroller: function () {
		this.log();
		this.$.scrollTracks.destroyControls();
	},

	requestTrackList: function () {
		this.log();
		this.doRequestTracks(enyo.bind(this, this.gotTracks));
	},

	gotTracks: function (arTrackResponse, intCurrTrackIndex, boolTrackPlaying) {
		this.log();
		this._arFullTrackList = arTrackResponse.slice(0);
		this.boolGotTracks = true;
		this.intCurrTrackIndex = intCurrTrackIndex;
		this.boolAudioPlaying = boolTrackPlaying;
		this.populateScroller(intCurrTrackIndex);
	},

	onSnap_scrollTracks: function () {
		this.log();
	},

	onSnapFinish_scrollTracks: function (sender) {
		var currentItem;
		try {
			this.log();
			if (this.intervalAnimate !== undefined) {
				window.clearInterval(this.intervalAnimate);
			}
			this.intCurrSnapPos = sender.index;
			this.log("this.intCurrSnapPos: ", this.intCurrSnapPos);
			currentItem = this._getSnapItem(1);
			if (this.boolUpdateScroller && currentItem && currentItem.intTrackIndex >= 0) {
				this.populateScroller(currentItem.intTrackIndex);
				this.setItemsDisplay(this.intCurrSnapPos);
			}
		} catch (err) {
			this.log("Error: ", err);
		}
		this.boolUpdateScroller = true;
	},

	setItemsDisplay: function (intCurrIndex, boolShowCurrIcon) {
		this.log("intCurrIndex: ", intCurrIndex);
		return true;
	},

	changeTrack: function (objTrackInfo) {
		var currentItem = this._getSnapItem(1);
		var intIndexDiff;
		this.log(objTrackInfo.intTrackIndex);
		if (!currentItem) {
			this.intCurrTrackIndex = objTrackInfo.intTrackIndex;
			if (this.boolGotTracks) {
				this.populateScroller(this.intCurrTrackIndex);
			}
			return;
		}
		intIndexDiff = objTrackInfo.intTrackIndex - currentItem.intTrackIndex;
		this.log("this.intCurrSnapPos: ", this.intCurrSnapPos);
		this.log("objTrackInfo.intTrackIndex: ", objTrackInfo.intTrackIndex);
		this.log("currentItem.intTrackIndex: ", currentItem.intTrackIndex);
		this.log("intIndexDiff: ", intIndexDiff);
		this.intCurrTrackIndex = objTrackInfo.intTrackIndex;
		if (this.boolGotTracks) {
			if (intIndexDiff >= -2 && intIndexDiff <= 2) {
				this.boolUpdateScroller = true;
				this.log("snapTo: ", (this.intCurrSnapPos + intIndexDiff));
				this.$.scrollTracks.snapTo(this.intCurrSnapPos + intIndexDiff);
				this.updatePlayPauseItems(undefined, objTrackInfo.intTrackIndex);
			} else {
				this.populateScroller(this.intCurrTrackIndex);
			}
		}
	},

	setPlayPause: function (boolAudioPlaying) {
		this.log();
		this.log(boolAudioPlaying);
		this.boolAudioPlaying = boolAudioPlaying;
		this.updatePlayPauseItems();
	},

	updatePlayPauseItems: function (boolAudioPlaying, intCurrTrackIndex) {
		var items = this._getScrollerItems();
		var intCheckIndex;
		if (boolAudioPlaying !== undefined) {
			this.boolAudioPlaying = boolAudioPlaying;
		}
		for (intCheckIndex = 0; intCheckIndex < items.length; intCheckIndex++) {
			if (items[intCheckIndex] && items[intCheckIndex].checkIfCurrentTrack) {
				items[intCheckIndex].checkIfCurrentTrack(this.boolAudioPlaying, intCurrTrackIndex);
			}
		}
	},

	onScrollStart_scrollTracks: function () {
	},

	onScrollStop_scrollTracks: function () {
		if (this.intervalAnimate !== undefined) {
			window.clearInterval(this.intervalAnimate);
		}
	}
});