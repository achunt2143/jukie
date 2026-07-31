/*globals enyo, $L, event, Utilities, window, setTimeout, clearTimeout */
enyo.kind({
    name: "kindNavPanel",
    kind: "VFlexBox",
    events: {
        onClick_NowPlaying: "",
        onClick_ListView: "",
        onClick_LibraryView: "",
        onResetDetailView: "",
        onClick_ExhibitionMode: "",
        onRequestPlaylists_NavPanel: "",
        onClickPlaylist_NavPanel: "",
        onCreatePlaylist_NavPanel: "",
        onDeletePlaylist_NavPanel: "",
        onRefreshLibrary: ""
    },
    components: [
        {name: "navNowPlaying", className: "playing enyo-toolbar enyo-toolbar-light", kind: "Drawer", open: true, onOpenAnimationComplete: "onOpenAnimationComplete", components: [
            {kind: "Control", className: "content", layoutKind: "HFlexLayout", pack: "start", align: "start", height: "48px", onclick: "onclick_NowPlaying", components: [
                {kind: "Control", name: "ctrlDefaultThumb", showing: false, className: "cover", layoutKind: "VFlexLayout", align: "center", pack: "center", components: [
                    {className: "img", name: "imgContainer", layoutKind: "VFlexLayout", align: "center", pack: "center", components: [
                        {name: "imgAlbumArt", kind: "Image"}
                    ]}
                ]},
                {kind: "Control", className: "info", flex: 1, components: [
                    {name: "lblNowPlayingText", content: "", className: "label"},
                    {name: "lblNowPlayingSubText", content: "", className: "title"}
                ]},
                {kind: "Control", className: "shadow"}
            ]}
        ]},
        {name: "navScroller", kind: "Scroller", flex: 1, components: [
            {name: "navAppleMusic", kind: "DividerDrawer", className: "library", caption: $L("Apple Music"), animate: true, onOpenChanged: "onOpenAnimationComplete", components: [
                {name: "catSongs", kind: "Item", layoutKind: "HFlexLayout", pack: "start", align: "center", navstring: "Songs", className: "songs", onclick: "onClickCatalog", components: [
                    {className: "icon"},
                    {content: $L("Songs"), className: "name", flex: 1}
                ]},
                {name: "catArtists", kind: "Item", layoutKind: "HFlexLayout", pack: "start", align: "center", navstring: "Artists", className: "artists", onclick: "onClickCatalog", components: [
                    {className: "icon"},
                    {content: $L("Artists"), className: "name", flex: 1}
                ]},
                {name: "catAlbums", kind: "Item", layoutKind: "HFlexLayout", pack: "start", align: "center", navstring: "Albums", className: "albums", onclick: "onClickCatalog", components: [
                    {className: "icon"},
                    {content: $L("Albums"), className: "name", flex: 1}
                ]}
            ]},
            {name: "navLibrary", kind: "DividerDrawer", className: "library", caption: $L("Your Library"), animate: true, onOpenChanged: "onOpenAnimationComplete", components: [
                {name: "libSongs", kind: "Item", layoutKind: "HFlexLayout", pack: "start", align: "center", navstring: "Songs", className: "songs active", onclick: "onClickLibraryView", components: [
                    {className: "icon"},
                    {content: $L("Songs"), className: "name", flex: 1},
                    {kind: "Spinner", showing: false, name: "songSpinner"}
                ]},
                {name: "libArtists", kind: "Item", layoutKind: "HFlexLayout", pack: "start", align: "center", navstring: "Artists", className: "artists", onclick: "onClickLibraryView", components: [
                    {className: "icon"},
                    {content: $L("Artists"), className: "name", flex: 1}
                ]},
                {name: "libAlbums", kind: "Item", layoutKind: "HFlexLayout", pack: "start", align: "center", navstring: "Albums", className: "albums", onclick: "onClickLibraryView", components: [
                    {className: "icon"},
                    {content: $L("Albums"), className: "name", flex: 1}
                ]}
            ]},
            {name: "navPlaylistDrawer", kind: "DividerDrawer", caption: $L("Playlists"), animate: true, onOpenChanged: "onOpenAnimationComplete", components: [
                {name: "navPlaylists", kind: "navplaylists", onRequestPlaylists: "doRequestPlaylists_NavPanel", onClickPlaylist: "onClickPlaylist", onCreatePlaylist: "doCreatePlaylist_NavPanel", onDeletePlaylist: "doDeletePlaylist_NavPanel"}
            ]}
        ]},
        {name: "navToolbar", kind: "Toolbar", pack: "justify", align: "center", className: "enyo-toolbar-light", components: [
            {name: "btnRefreshLibrary", kind: "IconButton", label: $L("Refresh"), className: "enyo-button-light", onclick: "onClickRefreshLibrary"},
            {name: "btnNewPlaylist", kind: "IconButton", label: $L("New Playlist"), className: "enyo-button-light", onclick: "onclick_btnNewPlaylist"}
        ]},
        {name: "navExhibitionTest", kind: "HFlexBox", tapHighlight: false, height: "40px", className: "navMainOff", showing: false, components: [
            {content: $L("Exhibition"), className: "navMainLbl", onclick: "doClick_ExhibitionMode"}
        ]}
    ],

    statics: {
        _playBackMap: {
            "song": $L("Song"),
            "genre": $L("Genre"),
            "album": $L("Album"),
            "artist": $L("Artist"),
            "playlist": $L("Playlist")
        }
    },

    strNowPlayingType: "",
    strNowPlayingText: "",
    strNowPlayingArtist: "",
    strNowPlayingSubText: "",
    strNowPlayingImage: "",
    arNowPlayingThumbs: [],
    strPlaylistKind: "",
    strPlaylistID: "",

    create: function () {
        this.inherited(arguments);
        // Default to Library → Songs (populated from db8)
        this.objCurrNavItem = this.$.libSongs;
    },

    rendered: function () {
        this.log();
        this.inherited(arguments);
        this.onOpenAnimationComplete();
        this.$.navPlaylists.renderList();
    },

    onclick_btnNewPlaylist: function () {
        this.$.navPlaylists.ShowPopNewPlaylist();
    },

    onClickCatalog: function (sender) {
        this.changeSelectedLibrary(sender);
        enyo.asyncMethod(this, "doClick_ListView", sender.navstring);
    },

    onClickLibraryView: function (sender) {
        this.changeSelectedLibrary(sender);
        enyo.asyncMethod(this, "doClick_LibraryView", sender.navstring);
    },

    onClickRefreshLibrary: function () {
        this.doRefreshLibrary();
    },

    // Keep for back-compat (onclick_NowPlaying uses it by ref)
    onClickLibrary: function (sender) {
        this.changeSelectedLibrary(sender);
        enyo.asyncMethod(this, "doClick_LibraryView", sender.navstring);
    },

    changeSelectedLibrary: function (objNavLibraryItem, reset) {
        this.log("objNavLibraryItem: ", objNavLibraryItem);
        this.log("reset: ", reset);

        if (reset === undefined) {
            reset = true;
        }

        if (!objNavLibraryItem) {
            return;
        }

        this.log(objNavLibraryItem.navstring);

        if (this.objCurrNavItem === objNavLibraryItem) {
            if (reset) {
                enyo.asyncMethod(this, "doResetDetailView");
            }
            return;
        }

        if (this.objCurrNavItem) {
            this.objCurrNavItem.removeClass("active");
        }

        objNavLibraryItem.addClass("active");
        this.objCurrNavItem = objNavLibraryItem;
        this.$.navPlaylists.clearSelection();
    },

    onClickPlaylist: function (sender, objClickPlaylist) {
        this.changeSelectedPlaylist(objClickPlaylist);
    },

    changeSelectedPlaylist: function (objClickPlaylist) {
        if (!objClickPlaylist) {
            return;
        }

        if (this.objCurrNavItem) {
            this.objCurrNavItem.removeClass("active");
            enyo.asyncMethod(this, "doResetDetailView");
        }

        this.objCurrNavItem = undefined;

        if (objClickPlaylist.strPlaylistID !== undefined && objClickPlaylist.strPlaylistID !== "") {
            this.$.navPlaylists.setStrSelectedPlaylistID(objClickPlaylist.strPlaylistID);
        } else if (objClickPlaylist.strPlaylistFile !== undefined && objClickPlaylist.strPlaylistFile !== "") {
            this.$.navPlaylists.setStrSelectedPlaylistFile(objClickPlaylist.strPlaylistFile);
        }

        enyo.asyncMethod(this, "doClickPlaylist_NavPanel", objClickPlaylist);
    },

    editPlaylist: function (strEditPlaylistID) {
        this.log();
        this.$.navPlaylists.setStrEditPlaylistID(strEditPlaylistID);
    },

    setNowPlayingMode: function (objSetPlaybackList) {
        var strThumbURL = "";

        this.log();

        this.strNowPlayingType = objSetPlaybackList.strListType;
        this.strNowPlayingText = objSetPlaybackList.strListText;
        this.strNowPlayingArtist = objSetPlaybackList.strArtist || "";
        this.strNowPlayingSubText = objSetPlaybackList.strListSubText || "";
        this.arNowPlayingThumbs = objSetPlaybackList.arThumbnails || [];
        this.strNowPlayingImage = objSetPlaybackList.strTrackImage || objSetPlaybackList.artUrl || "";

        if (objSetPlaybackList.strListType === "Playlist") {
            this.strPlaylistKind = objSetPlaybackList.strPlaylistKind;
            this.strPlaylistID = objSetPlaybackList.strPlaylistID;
        } else {
            this.strPlaylistKind = "";
            this.strPlaylistID = "";
        }

        this.$.lblNowPlayingText.setContent(objSetPlaybackList.strListText || "");
        this.$.lblNowPlayingSubText.setContent(objSetPlaybackList.strListSubText || "");
        this.$.ctrlDefaultThumb.show();

        if (this.strNowPlayingImage) {
            strThumbURL = this.strNowPlayingImage;
        } else if (this.arNowPlayingThumbs && this.arNowPlayingThumbs.length > 0 && this.arNowPlayingThumbs[0] && this.arNowPlayingThumbs[0].data) {
            strThumbURL = this.arNowPlayingThumbs[0].data;
        }

        this.setNowPlayingImage(strThumbURL);
    },

    updateNowPlaying: function (objTrackInfo) {
        var strThumbURL = "";

        this.$.lblNowPlayingText.setContent(objTrackInfo.strTrackTitle || "");
        this.$.lblNowPlayingSubText.setContent(objTrackInfo.strTrackArtist || "");
        this.$.ctrlDefaultThumb.show();
        strThumbURL = objTrackInfo.strTrackImage || "";
        this.setNowPlayingImage(strThumbURL);
    },

    setNowPlayingImage: function (strThumbURL) {
        if (strThumbURL) {
            this.$.imgAlbumArt.setSrc(strThumbURL);
            this.$.imgContainer.show();
        } else {
            this.$.imgAlbumArt.setSrc("");
            this.$.imgContainer.hide();
        }
    },

    onclick_NowPlaying: function () {
        var objParams = {
            name: this.strNowPlayingText,
            artist: this.strNowPlayingArtist,
            thumbnails: this.arNowPlayingThumbs,
            artUrl: this.strNowPlayingImage,
            showParentView: true
        };

        switch (this.strNowPlayingType) {
        case "Song":
            this.changeSelectedLibrary(this.$.libSongs, false);
            enyo.asyncMethod(this, "doClick_ListView", "Songs", {forceJump: true});
            return;
        case "Artist":
            this.changeSelectedLibrary(this.$.libArtists, false);
            objParams.strListViewType = "Artists";
            break;
        case "Album":
            this.changeSelectedLibrary(this.$.libAlbums, false);
            objParams.strListViewType = "Albums";
            break;
        case "Playlist":
            var objPlaylist = {
                strPlaylistName: this.strNowPlayingText,
                strPlaylistID: this.strPlaylistID,
                strPlaylistKind: this.strPlaylistKind,
                boolForceRender: true
            };
            this.changeSelectedPlaylist(objPlaylist, false);
            this.$.navPlaylists.refreshList();
            return;
        default:
            return;
        }

        enyo.asyncMethod(this, "doClick_NowPlaying", objParams);
    },

    playlistDeleted: function (playlistObj) {
        if (this.strPlaylistID === playlistObj.strPlaylistID) {
            this.strPlaylistID = undefined;
        }
    },

    onOpenAnimationComplete: function () {
        this.resizeContent();
    },

    // This fires on EVERY drawer's open/close (all three DividerDrawers map their
    // onOpenChanged to this same handler), not just the Playlists one. It used to also
    // resize navPlaylists based on navPlaylistDrawer's own bounds - but that was from
    // before the "all three sections share one scroll" fix, which made navplaylists.js
    // size its VirtualList by CONTENT (arPlaylists.length * ROW_HEIGHT, set once in
    // gotPlaylists() whenever data loads) instead of by the drawer's viewport. Since this
    // handler fires on every collapse/expand regardless of whether new data loaded, it was
    // overwriting that correct content-based height with a stale/mismatched drawer-bounds
    // value on every re-open - collapsing then expanding the Playlists drawer showed an
    // empty list (arPlaylists was still populated in memory, but the VirtualList's height
    // had been clobbered down to whatever the drawer's own bounds happened to be at that
    // moment). Removed; navplaylists.js already resizes itself correctly when its data
    // loads and doesn't need anyone else re-sizing it on drawer toggles.
    resizeContent: function () {
        this.resized();
    },

    refreshPlaylists: function () {
        this.$.navPlaylists.renderList();
    },

    setIndexingStatus: function (boolIndexing) {
        this.$.songSpinner.setShowing(boolIndexing);
    }
});