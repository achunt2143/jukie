/*globals enyo, setTimeout, $L, event, Utilities, window, PalmSystem */
enyo.kind({
	name: "MusicPlayerApp",
	kind: "Control",
	width: "100%",
	components: [
		{ name: "appEvent", kind: "ApplicationEvents", onWindowActivated: "windowActivatedHandler", onWindowDeactivated: "windowDeactivatedHandler", onWindowHidden: "windowHiddenHandler", onWindowShown: "windowShownHandler", onWindowParamsChange: "windowParamsChangeHandler", onUnload: "unloadHandler", onApplicationRelaunch: "applicationRelaunchHandler"},

		{name: "psSetVolumeLock", kind: "PalmService", service: "palm://com.palm.audio/", method: "media/lockVolumeKeys", subscribe: true, onSuccess: "onSuccess_VolumeLock", onFailure: "onFailure_VolumeLock"},
		{name: "psDisplay", kind: "PalmService", service: "palm://com.palm.display/control/", method: "status", onSuccess: "onSuccess_RequestDisplayStatus", onFailure: "onFailure_RequestDisplayStatus", subscribe: true},
		{name: "psAVRCPStatus", kind: "PalmService", service: "palm://com.palm.keys/", method: "media/status", onSuccess: "onSuccess_RequestAVRCPStatus", onFailure: "onFailure_RequestAVRCPStatus", subscribe: true},
		{name: "psHeadsetStatus", kind: "PalmService", service: "palm://com.palm.keys/headset/", method: "status", onSuccess: "onSuccess_RequestHeadsetStatus", onFailure: "onFailure_RequestHeadsetStatus", subscribe: true},
		{name: "psBroadcaster", kind: "PalmService", service: "palm://com.palm.service.mediabroadcast/", method: "registerBroadcaster", onSuccess: "onSuccess_SetBroadcaster", onFailure: "onFailure_SetBroadcaster", subscribe: true},
		{name: "psUpdateBroadcaster", kind: "PalmService", service: "palm://com.palm.service.mediabroadcast/", method: "update", onSuccess: "onSuccess_SetBroadcaster", onFailure: "onFailure_SetBroadcaster"},

		{name: "AppleMusicService", kind: "AppleMusicService", developerToken: window.APPLE_MUSIC_DEVELOPER_TOKEN || "", musicUserToken: window.APPLE_MUSIC_USER_TOKEN || "", storefront: "us", debug: false},
		{name: "DB8", kind: "kindDB8"},
		{name: "LibraryCache", kind: "kindLibraryCache", onSyncDone: "onLibrarySyncDone", onSyncError: "onLibrarySyncError"},
		{name: "Settings", kind: "kindSettings"},
		{name: "MediaIndex", kind: "kindMediaIndex", onSetPlaybackList: "onSetPlaybackList"},
		{name: "PlaylistManager", kind: "kindPlaylistManager", onRequestMedia: "onRequestMedia_ListView", onRefreshPlaylists: "refreshPlaylists", onPlaylistDeleted: "onPlaylistDeleted"},
		{name: "Playback", kind: "kindPlayback", onPlaybackListIDChanged: "onPlaybackListIDChanged", onSongEnd: "onSongEnd", onTrackPlaying: "onTrackPlaying", onTrackEnded: "onTrackEnded", onTrackPausePlay: "onTrackPausePlay", onTrackSrcChanged: "onTrackSrcChanged", onUpdateTrackInfo: "onUpdateTrackInfo", onUpdateTrackTime: "onUpdateTrackTime", onPlaybackShuffleChanged: "onShuffleChanged_Playback", onPlaybackRepeatChanged: "onRepeatChanged_Playback", onPlaybackListSet: "onPlaybackListSet", onTrackBuffering: "onTrackBuffering", onPermissionError: "onPlaybackPermissionError"},
		{name: "DashboardManager", kind: "kindDashboardManager"},
		{name: "ExhibitionManager", kind: "kindExhibitionManager"},
		{name: "PlaybackSession", kind: "kindPlaybackSession"},

		{name: "paneAll", className: "wrapper", flex: 1, height: "100%", width: "100%", kind: "Pane", components: [
			{kind: "VFlexBox", tapHighlight: true, components: [
				{name: "paneTop", className: "paneTop", flex: 1, width: "100%", kind: "Pane", transitionKind: "enyo.transitions.Simple", components: [
					{kind: "HFlexBox", flex: 1, height: "100%", width: "100%", components: [
						{name: "navPanel", width: "320px", className: "navigation", kind: "kindNavPanel", height: "100%", onClick_ListView: "onClick_ListView", onResetDetailView: "onResetDetailView", onClick_ExhibitionMode: "onClick_ExhibitionMode", onRequestPlaylists_NavPanel: "onRequestPlaylists", onClickPlaylist_NavPanel: "onClickPlaylist_NavPanel", onCreatePlaylist_NavPanel: "onCreatePlaylist_NavPanel", onDeletePlaylist_NavPanel: "onDeletePlaylist", onClick_NowPlaying: "onClick_NowPlaying", onClick_LibraryView: "onClick_LibraryView", onRefreshLibrary: "onRefreshLibrary_NavPanel"},
						{name: "paneMainView", className: "view", flex: 1, kind: "Pane", onSelectView: "onSelectView_PaneMainView", transitionKind: "enyo.transitions.Simple", components: [
							{name: "viewListViewSongs", flex: 1, components: [
								{name: "listViewSongs", kind: "kindListViewSongs", flex: 1, onSetPlaybackList: "onSetPlaybackList", onRequestMedia: "onRequestMedia_ListView", onListChanged: "onUIListChanged", onListSorted: "onUIListSorted", onEnableControls: "onControlsEnabled", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon", onRequestCurrTrackInfo: "onRequestCurrTrackInfo"}
							]},
							{name: "viewListViewArtists", kind: "SlidingPane", multiView: false, multiViewMinWidth: 1100, flex: 1, components: [
								{name: "sldListViewArtists", flex: 1, components: [
									{name: "listViewArtists", kind: "kindListViewArtists", onSetPlaybackList: "onSetPlaybackList", onRequestMedia: "onRequestMedia_ListView", onSelectArtist: "onSelectArtistDetail", onRequestPlaylists: "onRequestPlaylists", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
								]},
								{name: "sldListViewArtistDetail", edgeDragging: false, dragAnywhere: false, components: [
									{name: "listViewArtistDetail", kind: "kindListViewArtistDetail", flex: 1, showing: true, onRequestMedia: "onRequestMedia_ListView", onRequestCurrTrack: "onRequestCurrTrackInfo", onSetPlaybackList: "onSetPlaybackList", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
								]}
							]},
							{name: "viewListViewAlbums", kind: "SlidingPane", multiView: false, multiViewMinWidth: 1100, components: [
								{name: "sldListViewAlbums", components: [
									{name: "listViewAlbums", kind: "kindListViewAlbums", onSetPlaybackList: "onSetPlaybackList", onRequestMedia: "onRequestMedia_ListView", onSelectAlbum: "onSelectAlbumDetail", onRequestPlaylists: "onRequestPlaylists", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
								]},
								{name: "sldListViewAlbumDetail", edgeDragging: false, dragAnywhere: false, components: [
									{name: "listViewAlbumDetail", kind: "kindListViewAlbumDetail", flex: 1, showing: true, onRequestMedia: "onRequestMedia_ListView", onListChanged: "onUIListChanged", onRequestCurrTrack: "onRequestCurrTrackInfo", onSetPlaybackList: "onSetPlaybackList", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
								]}
							]},
							{name: "viewListViewGenres", kind: "SlidingPane", multiView: false, multiViewMinWidth: 1100, components: [
								{name: "sldListViewGenres", components: [
									{name: "listViewGenres", kind: "kindListViewGenres", onSetPlaybackList: "onSetPlaybackList", onRequestMedia: "onRequestMedia_ListView", onSelectGenre: "onSelectGenreDetail", onRequestPlaylists: "onRequestPlaylists", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
								]},
								{name: "sldListViewGenreDetail", edgeDragging: false, dragAnywhere: false, components: [
									{name: "listViewGenreDetail", kind: "kindListViewGenreDetail", flex: 1, showing: true, onRequestMedia: "onRequestMedia_ListView", onRequestCurrTrack: "onRequestCurrTrackInfo", onSetPlaybackList: "onSetPlaybackList", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
								]}
							]},
							{name: "viewListViewPlaylist", flex: 1, components: [
								{name: "listViewPlaylist", kind: "kindListViewPlaylist", flex: 1, onSetPlaybackList: "onSetPlaybackList", onRequestMedia: "onRequestMedia_ListView", onRequestPlaylist: "onRequestPlaylists", onUpdatePlaylist: "onUpdatePlaylist", onDeletePlaylist: "onDeletePlaylist", onListChanged: "onUIListChanged", onListSorted: "onUIListSorted", onEditPlaylist: "onEditPlaylist", onRequestCurrTrack: "onRequestCurrTrackInfo", onAddToPlaylist: "onAddToPlaylist", onItemDrag: "onItemDrag", onItemShowAvatar: "onItemShowAvatar", onItemShowAvatarIcon: "onItemShowAvatarIcon"}
							]},
							{name: "viewSettings", flex: 1, components: [
								{name: "settingsView", kind: "kindSettingsView", flex: 1, onSaveSettings: "onSaveSettings_View", onCloseSettings: "onCloseSettings_View", onClearCache: "onClearCache_View"}
							]},
							{name: "viewHelp", flex: 1, components: [
								{name: "helpView", kind: "kindHelpView", flex: 1, onCloseHelp: "onCloseHelp_View"}
							]}
						]}
					]},
					{name: "AlbumArtView", kind: "KindAlbumArtView", onRequestTracks: "onRequestTracks_AlbumArtView", onClickAlbumArtView: "onClickAlbumArtViewTrack"}
				]},
				{name: "PlayerControl", kind: "kindPlayerControl", onClickNext: "onClickNext", onClickPrev: "onClickPrev", onClickPlayPause: "onClickPlayPause", onSetPlaybackTime: "onSetPlaybackTime", onShuffleClick: "onShuffleClick_PlayModeControls", onRepeatClick: "onRepeatClick_PlayModeControls", onSetVolume: "onSetPlaybackVolume", onRequestVolume: "onRequestSysVolume", onClickFullScreen: "onClick_FullScreen"},
				{name: "btnBack", content: $L("Back"), onclick: "onClick_btnBackAlbumArtView", style: "position: fixed; right: 20px; top: 20px;", showing: false}
			]}
		]},
		{name: "avatartop", kind: "Control", showing: false, className: "drag", components: [
			{className: "cover", components: [
				{name: "imgContainer", className: "img", components: [
					{name: "imgAvatar", kind: "Image", onerror: "onError_imgAvatar"}
				]}
			]},
			{name: "imgAvatarIcon", className: "action", components: [
				{kind: "Control", className: "add"}
			]}
		]},
		{kind: "AppMenu", components: [
			{caption: $L("Preferences"), onclick: "openSettings"},
			{caption: $L("Exhibition Mode"), onclick: "onClick_ExhibitionMode"},
			{caption: $L("Help"), onclick: "openHelp"}
		]},
		// Blocks app usage while a library refresh is in flight (replaces a small
		// in-button spinner - a full re-sync is a real full-app operation, not something
		// that should look like the user can keep browsing while it happens).
		{name: "refreshScrim", kind: "Scrim", showing: false, layoutKind: "VFlexLayout", align: "center", pack: "center", className: "jukieRefreshScrim", components: [
			{kind: "SpinnerLarge"},
			{content: $L("Refreshing Library…"), className: "jukieRefreshScrimLabel"}
		]}
	],

	boolWindowActive: false,
	boolLandscape: true,
	boolAlbumArtViewDisplay: false,
	boolSettingsViewDisplay: false,
	boolExhibitionViewDisplay: false,
	boolPlaybackListSet: false,
	boolCanPlay: false,
	boolPlayStarted: false,
	boolDefaultLoad: true,
	boolAppLoaded: false,
	boolAppleMusicReady: false,
	boolAppleMusicInitFailed: false,
	boolBroadcasterAvailable: true,

	ListView: null,
	cacheTrackInfo: null,
	cacheBoolAudioPlaying: false,
	cacheTrackTimes: null,
	showParams: {},

	handleLaunch: function (launchParams)
	{
		this.log("launchParams: ", launchParams);
	},

	create: function (launchParams)
	{
		this.inherited(arguments);
		this.log();
		try
		{
			if (window.PalmSystem)
			{
				this.log("Setting keepAlive");
				PalmSystem.keepAlive(true);
				this.log("keepAlive set");
			}

			this.log("launchParams: ", launchParams);
			this.log("enyo.windowParamas: ", enyo.windowParams);

			this.injectAppleMusicDependencies();
			this.RequestHeadsetStatus();
			this.RequestAVRCPStatus();
			this.$.psBroadcaster.call();
			enyo.keyboard.setResizesWindow(false);
		}
		catch (err)
		{
			this.log(err);
		}
	},

	injectAppleMusicDependencies: function ()
	{
		this.appleMusicService = this.$.AppleMusicService;
		this.$.MediaIndex.appleMusicService = this.appleMusicService;
		this.$.PlaylistManager.appleMusicService = this.appleMusicService;
		this.$.LibraryCache.setAppleMusicService(this.appleMusicService);
		this.$.LibraryCache.setDb8(this.$.DB8);
		this.$.Settings.setDb8(this.$.DB8);

		this.appleMusicService.on("onAppleMusicError", enyo.bind(this, "onAppleMusicError"));
		this.appleMusicService.on("onDeveloperTokenRefreshed", enyo.bind(this, "onDeveloperTokenAutoRefreshed"));
	},

	// Trigger a one-time library sync into db8 if we haven't cached it yet. The real
	// trigger will be a Refresh button (#6); for now this populates db8 on first launch.
	syncLibraryIfEmpty: function ()
	{
		var self = this;
		this.$.LibraryCache.ensureSchema().then(function ()
		{
			return self.$.LibraryCache.count("album");
		}).then(function (n)
		{
			if (n > 0)
			{
				self.log("library already cached (" + n + " albums); skipping sync");
				return;
			}
			self.log("library cache empty - syncing from Apple");
			return self.$.LibraryCache.sync();
		}).catch(function (err)
		{
			self.log("library init failed (db8/perms?):", err);
		});
	},

	onLibrarySyncDone: function ()
	{
		this.log("library sync done");
		// If the user is looking at a library view, re-render it now that data exists.
		if (this.libraryMode && this.ListView && this.ListView.renderList)
		{
			this.ListView.renderList();
		}
	},

	onLibrarySyncError: function (sender, payload)
	{
		this.log("library sync error", payload && payload.error);
	},

	// jukie-drm's executable bit not surviving packaging/install on this device (confirmed
	// on a real Pre2 even with the package-level chmod fix - see JukieAudioService.js's own
	// comment and post-install-jukie.ps1) is a real, recurring failure mode with a real,
	// on-device fix - so surface it as an actionable message instead of playback just
	// silently skipping to the next track. Bubbled here from kindPlayback.onAudioError via
	// onPermissionError; see that file's own comment for the full chain. Built as a
	// dynamically-created ModalDialog (there's no static one declared anywhere in this
	// tree to reuse) and cached on first use so a second occurrence doesn't pile up dead
	// popup nodes.
	onPlaybackPermissionError: function ()
	{
		if (!this.$.permissionErrorDialog)
		{
			this.createComponent({
				name: "permissionErrorDialog", kind: "ModalDialog", caption: "Permissions bug",
				components: [
					{content: "Hey!! Looks like you've ran into the permissions bug! Plug me " +
						"in to novaterm and run this command: chmod +x " +
						"/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos2 " +
						"/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-webos3",
						style: "padding: 12px;"},
					{kind: "Button", caption: "OK", onclick: "closePermissionErrorDialog", style: "margin: 12px;"}
				]
			}, {owner: this});
			this.$.permissionErrorDialog.render();
		}
		this.$.permissionErrorDialog.openAtCenter();
	},

	closePermissionErrorDialog: function ()
	{
		this.$.permissionErrorDialog.hide();
	},

	ready: function ()
	{
	},

	rendered: function ()
	{
		this.inherited(arguments);
		this.log();
		this.log("enyo.windowParamas: ", enyo.windowParams);

		if (enyo.windowParams.action)
		{
			this.boolDefaultLoad = !(enyo.windowParams.action === "show" && enyo.windowParams.showparams);
		}

		this.RequestDisplayStatus();
		this.initAppleMusic();
	},

	initAppleMusic: function ()
	{
		var self = this;
		// Load persisted prefs (tokens etc.) and apply them BEFORE validating the
		// service, so a user-entered token overrides the build-time window default.
		// load() always resolves (defaults on error), so the boot path never stalls.
		this.$.Settings.load().then(function (settings)
		{
			self._bootWithSettings(settings);
		}).catch(function (err)
		{
			self.log("settings load failed, using defaults:", err);
			self._bootWithSettings(null);
		});
	},

	_bootWithSettings: function (settings)
	{
		this.applySettings(settings, false);
		this.boolAppleMusicReady = this.appleMusicService.ready();
		this.boolAppleMusicInitFailed = !this.boolAppleMusicReady;
		this.finishInitialLoad();
		// Fire-and-forget: if the token we just applied is missing/near-expiry, try to
		// silently replace it with a fresh one scraped from music.apple.com (same
		// public token jukie-drm already auto-refreshes for playback - see
		// utility/webtoken.js). Never blocks boot; onDeveloperTokenAutoRefreshed picks
		// up the result if/when it resolves. request()'s own 401 retry is the backstop
		// if this hasn't finished (or wasn't possible) before the library sync below
		// fires.
		this.appleMusicService.ensureDeveloperToken();
		// Populate the db8 library cache shortly after launch (off the critical path).
		setTimeout(enyo.bind(this, "syncLibraryIfEmpty"), 4000);
	},

	// A stale/missing Developer Token got silently replaced with one scraped live from
	// music.apple.com (see utility/webtoken.js). Write it through to secrets.local.json
	// immediately (same as onSaveSettings_View - see [[settings-save-db8-queue-bug]],
	// don't gate the file the native service reads behind db8), then best-effort persist
	// to Settings/db8 so it survives the next launch and shows correctly if the user
	// opens Preferences.
	// NOTE: emitSignal() invokes listeners as fn(payload) - a single argument, unlike
	// the (sender, payload) PalmService/event-bubbling convention used elsewhere in this
	// file (see onAppleMusicError, which is unintentionally always called with
	// payload===undefined for that reason - not touching that here, out of scope).
	onDeveloperTokenAutoRefreshed: function (payload)
	{
		var self = this;
		var token = payload && payload.token;
		var prev = this.appSettings || {};
		var merged;
		if (!token)
		{
			return;
		}
		this.log("developer token auto-refreshed from music.apple.com");
		merged = {
			developerToken: token,
			musicUserToken: prev.musicUserToken || "",
			storefront: prev.storefront || "us",
			cacheEnabled: prev.cacheEnabled !== false,
			streamQuality: prev.streamQuality || "high"
		};
		this.appSettings = merged;
		this.$.Playback.setCredentials(merged.developerToken, merged.musicUserToken);
		this.$.Settings.save(merged).catch(function (err)
		{
			self.log("auto-refreshed token: db8 persist failed (still applied in-memory + written to secrets file):", err);
		});
	},

	// Apply settings to the live AppleMusicService. Only non-empty tokens override the
	// build-time window defaults (so leaving a field blank keeps the existing token).
	// When boolResync is set (account changed via the dialog), re-pull the library.
	applySettings: function (settings, boolResync)
	{
		if (!settings)
		{
			return;
		}
		this.appSettings = settings;
		if (settings.developerToken)
		{
			this.appleMusicService.setDeveloperToken(settings.developerToken);
		}
		if (settings.musicUserToken)
		{
			this.appleMusicService.setMusicUserToken(settings.musicUserToken);
		}
		if (settings.developerToken || settings.musicUserToken)
		{
			// jukie-drm (full-track playback) has no way to receive these per-invocation -
			// it only reads a static secrets.local.json - so runs on every boot too
			// (not just Save), self-healing that file after a reinstall wipes it back to
			// a placeholder. developerToken here is the same "web developer token" value
			// secrets.local.json calls webDeveloperToken (see the Settings field's own
			// hint text). See kindPlayback.setCredentials / JukieAudioService.setCredentials.
			this.$.Playback.setCredentials(settings.developerToken, settings.musicUserToken);
		}
		if (settings.storefront)
		{
			this.appleMusicService.setStorefront(settings.storefront);
		}
		if (boolResync)
		{
			var self = this;
			this.boolAppleMusicReady = this.appleMusicService.ready();
			this.$.LibraryCache.sync().then(function ()
			{
				self.onLibrarySyncDone();
			}).catch(function (err)
			{
				self.log("resync after settings change failed:", err);
			});
		}
	},

	// Open the full-screen Preferences scene (swap paneTop to it, like fullscreen art).
	openSettings: function ()
	{
		var self = this;
		this.$.Settings.load().then(function (settings)
		{
			self._showSettingsView(settings);
		}).catch(function (err)
		{
			self.log("could not load settings:", err);
			self._showSettingsView(self.appSettings || null);
		});
	},

	// Slide Preferences into the content pane exactly like switching to a list view
	// (nav stays put, content transitions in from the right). Remember the view we came
	// from so Back/Save can slide back to it.
	_showSettingsView: function (settings)
	{
		var cur = this.$.paneMainView.getView();
		this._settingsReturnView = (cur && cur.name) ? cur.name : "viewListViewSongs";
		this.$.settingsView.setValues(settings || {});
		this.boolSettingsViewDisplay = true;
		this.$.paneMainView.selectViewByName("viewSettings", true);
	},

	// Back/Save from the Preferences scene -> slide back to where we were.
	_hideSettingsView: function ()
	{
		this.boolSettingsViewDisplay = false;
		this.$.paneMainView.selectViewByName(this._settingsReturnView || "viewListViewSongs", true);
		if (this.ListView && this.ListView.resizeList)
		{
			this.ListView.resizeList();
		}
	},

	onCloseSettings_View: function ()
	{
		this._hideSettingsView();
	},

	// Open the full-screen Help scene (same swap-paneTop mechanism as Preferences). Content
	// is static, so unlike openSettings there's no async load - straight to showing it.
	openHelp: function ()
	{
		var cur = this.$.paneMainView.getView();
		this._helpReturnView = (cur && cur.name) ? cur.name : "viewListViewSongs";
		this.$.paneMainView.selectViewByName("viewHelp", true);
	},

	_hideHelpView: function ()
	{
		this.$.paneMainView.selectViewByName(this._helpReturnView || "viewListViewSongs", true);
		if (this.ListView && this.ListView.resizeList)
		{
			this.ListView.resizeList();
		}
	},

	onCloseHelp_View: function ()
	{
		this._hideHelpView();
	},

	onSaveSettings_View: function (sender, settings)
	{
		var self = this;
		var prev = this.appSettings || {};
		var boolTokenChanged = (settings.musicUserToken !== prev.musicUserToken) ||
			(settings.developerToken !== prev.developerToken) ||
			(settings.storefront !== prev.storefront);
		// Apply (and in particular write secrets.local.json via Playback.setCredentials)
		// from the just-submitted values IMMEDIATELY, synchronously - do NOT wait on
		// Settings.save() below. kindDB8 serializes EVERY db8 call app-wide through one
		// queue (this.$.DB8 is shared with LibraryCache - see injectAppleMusicDependencies),
		// so a save made while the boot-time library sync is still churning (the common
		// case: first launch after install, Settings is blank, and syncLibraryIfEmpty's
		// sync of an empty library is exactly what's running while the user pastes their
		// first tokens and hits Save) would sit queued behind hundreds of sync calls -
		// or longer, if any one of them never resolves. The credentials file write has
		// nothing to do with db8 and must not inherit that queue's latency.
		this.applySettings(settings, boolTokenChanged);
		this.$.Settings.save(settings).catch(function (err)
		{
			self.log("settings save failed (secrets file + in-memory state are still up to date):", err);
		});
		this._hideSettingsView();
	},

	onClearCache_View: function (sender, callback)
	{
		this.$.Playback.clearCache(callback);
	},

	finishInitialLoad: function ()
	{
		if (this.boolAppLoaded) {
			return;
		}
		this.boolAppLoaded = true;
		this.log("this.boolDefaultLoad: ", this.boolDefaultLoad);
		if (enyo.windowParams.libItemId)
		{
			// Cold-launched from Just Type (universalSearch dbsearch) - a library result
			// was tapped; go straight to it instead of the default Library>Songs view.
			this.showLibraryItemById(enyo.windowParams.libItemId);
		}
		else if (this.boolDefaultLoad)
		{
			// Default to the user's Library (read from db8), not catalog search. This is
			// the primary view and makes the cached library visible on launch.
			this.libraryMode = "Songs";
			this.selectListView("Songs");
		}
		else
		{
			this.showContentItem(enyo.windowParams.showparams);
		}
	},

	onAppleMusicError: function (sender, payload)
	{
		this.log("Apple Music error", payload);
	},

	refreshListViews: function (arrListViews)
	{
		for (var i in arrListViews)
		{
			if (arrListViews[i])
			{
				this.$[arrListViews[i]].refreshList();
			}
		}
	},

	renderListViews: function (arrListViews)
	{
		for (var i in arrListViews)
		{
			if (arrListViews[i])
			{
				this.$[arrListViews[i]].renderList();
			}
		}
	},

	applicationLaunchHandler: function (launchParams)
	{
		this.log();
		this.log("launchParams: ", launchParams);
		this.log("enyo.windowParams: ", enyo.windowParams);
	},

	applicationRelaunchHandler: function (sender, launchParams)
	{
		this.log();
		this.log("launchParams: ", launchParams);
		this.log("enyo.windowParams: ", enyo.windowParams);
	},

	windowHiddenHandler: function ()
	{
		this.log();
		this.playPause(false);
		this.$.Playback.setBoolSuspendUpdates(true);
		this.$.Playback.setBoolSuspendPlayback(true);
		this.$.DashboardManager.closeControlDashboard();
	},

	windowShownHandler: function ()
	{
		this.log();
		this.$.Playback.setBoolSuspendUpdates(false);
		this.$.Playback.setBoolSuspendPlayback(false);
	},

	windowActivatedHandler: function ()
	{
		this.boolWindowActive = true;
		this.setVolumeLock(true);
		this.$.DashboardManager.closeControlDashboard();
		if (this.$.Playback.setIntUpdateRate)
		{
			this.$.Playback.setIntUpdateRate(333);
		}
	},

	windowDeactivatedHandler: function ()
	{
		this.log();
		this.boolWindowActive = false;
		this.$.DashboardManager.openControlDashboard();
		if (this.$.Playback.setIntUpdateRate)
		{
			this.$.Playback.setIntUpdateRate(3000);
		}
		this.setVolumeLock(false);
	},

	unloadHandler: function ()
	{
		this.log();
		// Capture the resume point BEFORE we stop playback, so a later dock (with Jukie
		// closed) can pick up where we left off. Best-effort: the async db8 write may not
		// finish before the process is killed, but the throttled periodic saves already
		// keep the stored position within ~7s, so at worst we lose a few seconds.
		this.saveSessionProgress();
		// App is closing/swiped away -> stop the service so it doesn't keep playing in
		// the background. (Minimizing fires windowDeactivated/Hidden, not unload, so this
		// only stops on a real close, not a minimize.)
		this.$.Playback.stopPlayback();
		this.$.DashboardManager.closeControlDashboard();
		this.setVolumeLock(false);
		try
		{
			var mainWin = enyo.windows.fetchWindow("com.achunt.jukie");
			if (mainWin)
			{
				this.log("closing main win");
				mainWin.close();
				mainWin = null;
			}
		}
		catch (err)
		{
			this.log("err:", err);
		}
	},

	windowRotatedHandler: function ()
	{
		this.log();
	},

	windowParamsChangeHandler: function ()
	{
		this.log();
		this.log("enyo.windowParams: ", enyo.windowParams);
		if (enyo.windowParams.gotoNowPlaying)
		{
			this.$.navPanel.onclick_NowPlaying();
		}
		if (enyo.windowParams.cmdType)
		{
			this.processDashCommand(enyo.windowParams.cmdType);
		}
		if (enyo.windowParams.libItemId)
		{
			// Warm relaunch from Just Type - app was already running.
			this.showLibraryItemById(enyo.windowParams.libItemId);
		}
		if (enyo.windowParams.action && enyo.windowParams.action === "show")
		{
			this.showContentItem(enyo.windowParams.showparams);
		}
		if (enyo.windowParams.requestExhibitionSync)
		{
			// Exhibition window just opened and has no track data of its own (it lives in
			// a separate window/JS context - see utility/exhibitionmanager.js) - resend it
			// everything we currently know instead of leaving it blank until the next
			// natural track-change event.
			if (this.cacheTrackInfo)
			{
				this.$.ExhibitionManager.pushTrackInfo(this.cacheTrackInfo);
			}
			this.$.ExhibitionManager.pushPlayState(this.cacheBoolAudioPlaying);
			if (this.cacheTrackTimes)
			{
				this.$.ExhibitionManager.pushTrackTime(this.cacheTrackTimes);
			}
		}
	},

	showContentItem: function (showParams)
	{
		this.log();
		this.log("showParams: ", showParams);
		if (showParams && showParams.showtype)
		{
			switch (showParams.showtype)
			{
				case "song":
					this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libSongs, false);
					if (showParams.songtitle && showParams.artistname)
					{
						this.onClick_ListView({}, "Songs", {strSongTitle: showParams.songtitle, strSongArtist: showParams.artistname, boolForceRender: true});
					}
					setTimeout(enyo.bind(this, "refreshListViews", ["listViewArtists", "listViewAlbums", "listViewGenres"]), 1000);
					break;
				case "artist":
					if (showParams.artistname)
					{
						this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libArtists, false);
						this.onSelectArtistDetail({}, {strListViewType: "Artists", name: showParams.artistname, showParentView: true, boolForceRender: true});
						setTimeout(enyo.bind(this, "refreshListViews", ["listViewSongs", "listViewAlbums", "listViewGenres"]), 1000);
					}
					break;
				case "album":
					if (showParams.albumname && (showParams.artistname || showParams.albumartist))
					{
						this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libAlbums, false);
						this.onSelectAlbumDetail({}, {strListViewType: "Albums", name: showParams.albumname, artist: showParams.albumartist || showParams.artistname, showParentView: true, boolForceRender: true});
						setTimeout(enyo.bind(this, "refreshListViews", ["listViewSongs", "listViewArtists", "listViewGenres"]), 1000);
					}
					break;
				case "genre":
					if (showParams.genrename)
					{
						this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libGenres, false);
						this.onSelectGenreDetail({}, {strListViewType: "Genres", name: showParams.genrename, showParentView: true, boolForceRender: true});
						setTimeout(enyo.bind(this, "refreshListViews", ["listViewSongs", "listViewArtists", "listViewAlbums"]), 1000);
					}
					break;
				case "playlist":
					if (showParams.playlistid)
					{
						this.$.navPanel.changeSelectedPlaylist({strPlaylistID: showParams.playlistid, strPlaylistKind: "com.palm.music.staticplaylists:1", boolForceRender: true});
						setTimeout(enyo.bind(this, "refreshListViews", ["listViewSongs", "listViewArtists", "listViewAlbums", "listViewGenres"]), 1000);
					}
					break;
			}
		}
	},

	openAppMenuHandler: function ()
	{
		this.log();
		this.$.appMenu.open();
	},

	closeAppMenuHandler: function ()
	{
		this.log();
		this.$.appMenu.close();
	},

	processDashCommand: function (cmdType)
	{
		this.log(cmdType);
		switch (cmdType)
		{
			case "prev":
				this.onClickPrev();
				break;
			case "playpause":
				this.onClickPlayPause();
				break;
			case "next":
				this.onClickNext();
				break;
		}
	},

	resizeHandler: function ()
	{
		this.log("window.innerWidth: ", window.innerWidth);
		this.log("window.innerHeight: ", window.innerHeight);
		this.boolLandscape = window.innerWidth > window.innerHeight;
		this.setClassName((this.boolLandscape ? "landscape enyo-fit enyo-vflexbox" : "portrait enyo-fit enyo-vflexbox"));
		this.$.AlbumArtView.orientationChanged(this.boolLandscape);
		this.$.navPanel.resizeContent();
		if (this.ListView && this.ListView.resizeList)
		{
			this.ListView.resizeList();
		}
		this.$.listViewGenres.setIntColumns((this.boolLandscape ? 4 : 3));
		if (this.$.paneMainView.getView())
		{
			this.$.paneMainView.getView().resized();
		}
		this.$.PlayerControl.resized();
	},

	RequestDisplayStatus: function ()
	{
		this.log();
		this.$.psDisplay.call();
	},

	onSuccess_RequestDisplayStatus: function (sender, response)
	{
		this.log();
		this.log(response);
		switch (response.event)
		{
			case "displayOff":
				this.$.Playback.setBoolSuspendUpdates(true);
				break;
			case "displayOn":
				this.$.Playback.setBoolSuspendUpdates(false);
				break;
		}
	},

	onFailure_RequestDisplayStatus: function ()
	{
		this.log();
	},

	onSongEnd: function ()
	{
		if (!this.$.PlayerControl.boolDraggingSlider)
		{
			this.$.Playback.nextTrack();
		}
		if (this.ListView && this.ListView.onTrackEnd)
		{
			this.ListView.onTrackEnd();
		}
	},

	onTrackPlaying: function ()
	{
		this.log();
		if (this.ListView && this.ListView.onTrackPlaying)
		{
			this.ListView.onTrackPlaying();
		}
		this.boolPlayStarted = true;
		// Belt-and-suspenders: once audio is DEFINITELY playing, the play button can't
		// still be "loading". Repeat-one restarts the same cached track fast enough that
		// the service's buffering flag can flip true->false without a poll catching the
		// false edge, leaving the spinner stuck spinning over already-playing audio.
		this.$.PlayerControl.setLoading(false);
	},

	onTrackEnded: function ()
	{
		this.log();
	},

	onTrackSrcChanged: function (sender, objTrackInfo)
	{
		this.log();
		this.cacheTrackInfo = objTrackInfo;
		this.sendTrackInfo(true);
		// New track within the same queue -> persist the new index (position resets to 0).
		this.saveSessionProgress();
	},

	sendTrackInfo: function (boolShowBanner, objParams)
	{
		this.log();
		if (this.cacheTrackInfo)
		{
			this.$.PlayerControl.updateTrackInfoDisplay(this.cacheTrackInfo);
			this.$.DashboardManager.updateControlDashboardInfo(this.cacheTrackInfo, this.boolWindowActive, boolShowBanner);
			this.$.ExhibitionManager.pushTrackInfo(this.cacheTrackInfo);
			if (this.ListView && this.ListView.highlightTrack !== undefined)
			{
				var jump = false;
				if (objParams)
				{
					jump = objParams.forceJump;
				}
				this.ListView.highlightTrack(this.cacheTrackInfo, jump);
			}
			if (this.boolAlbumArtViewDisplay)
			{
				this.$.AlbumArtView.changeTrack(this.cacheTrackInfo);
			}
			else
			{
				this.$.navPanel.updateNowPlaying(this.cacheTrackInfo);
			}
			this.updateBroadcaster({type: "trackChanged", track: this.cacheTrackInfo});
		}
	},

	onRequestCurrTrackInfo: function (sender, objParams)
	{
		this.sendTrackInfo(false, objParams);
	},

	onTrackBuffering: function (sender, payload)
	{
		this.log("buffering", payload && payload.buffering);
		this.$.PlayerControl.setLoading(!!(payload && payload.buffering));
	},

	onTrackPausePlay: function (sender, boolAudioPlaying)
	{
		this.log();
		this.log("boolAudioPlaying", boolAudioPlaying);
		this.$.PlayerControl.setPlayPause(boolAudioPlaying);
		this.$.DashboardManager.setPlayPause(boolAudioPlaying);
		this.cacheBoolAudioPlaying = boolAudioPlaying;
		this.$.ExhibitionManager.pushPlayState(boolAudioPlaying);
		if (this.boolAlbumArtViewDisplay)
		{
			this.$.AlbumArtView.setPlayPause(boolAudioPlaying);
		}
		this.updateBroadcaster({type: "playChanged", boolPlaying: boolAudioPlaying});
		// Persist the play/pause transition + current position (a natural resume point).
		this.saveSessionProgress();
	},

	onUpdateTrackInfo: function ()
	{
	},

	onUpdateTrackTime: function (sender, objTrackTimes)
	{
		this.$.PlayerControl.updateTrackTimeDisplay(objTrackTimes);
		this.cacheTrackTimes = objTrackTimes;
		this.$.ExhibitionManager.pushTrackTime(objTrackTimes);
		// Keep the persisted resume position roughly current (throttled to ~7s).
		this.maybeSaveSessionProgress();
	},

	resetScrollWatch: function ()
	{
		if (this.ListView && this.ListView._boolWaitToJump)
		{
			this.ListView._boolWaitToJump = false;
		}
	},

	onClickNext: function ()
	{
		this.resetScrollWatch();
		this.$.Playback.nextTrack(true);
	},

	onClickPrev: function ()
	{
		this.resetScrollWatch();
		this.$.Playback.prevTrack(true);
	},

	onClickPlayPause: function ()
	{
		this.playPause();
	},

	playPause: function (boolForcePlayPause)
	{
		this.log();
		if (this.$.Playback.getBoolPlaybackListSet())
		{
			this.$.Playback.pausePlayback(boolForcePlayPause);
		}
	},

	onControlsEnabled: function (sender, boolCanPlay, boolCanSkip)
	{
		this.log("boolCanPlay: ", boolCanPlay);
		this.log("boolCanSkip: ", boolCanSkip);
		if (boolCanPlay !== undefined)
		{
			this.$.PlayerControl.setPlayEnabled(boolCanPlay);
		}
		if (boolCanSkip !== undefined)
		{
			this.$.PlayerControl.setPrevNextEnabled(boolCanSkip);
		}
	},

	onSetPlaybackList: function (sender, objSetPlaybackList)
	{
		try
		{
			this.$.Playback.setPlaybackList(objSetPlaybackList);
			this.$.navPanel.setNowPlayingMode(objSetPlaybackList);
		}
		catch (err)
		{
			this.log("error: ", err);
		}
	},

	onPlaybackListIDChanged: function ()
	{
		this.$.listViewPlaylist.setStrPlaybackListID(this.$.Playback.getPlaybackListID());
	},

	onPlaybackListSet: function (sender, boolPlaybackListSet, intTrackCount, strShuffle, strRepeat)
	{
		this.log(boolPlaybackListSet);
		this.onControlsEnabled(null, boolPlaybackListSet, boolPlaybackListSet);
		this.updateBroadcaster({type: "playlistStart", intTrackCount: intTrackCount, strShuffle: strShuffle, strRepeat: strRepeat});
		this.boolPlaybackListSet = boolPlaybackListSet;
		// The queue just changed - persist the WHOLE session (queue + index + modes) so
		// Exhibition Mode can resume it when docked while Jukie isn't running. This is the
		// only heavy (full-queue) write; ongoing position/index updates go through the
		// lighter saveSessionProgress() below.
		this.saveSessionFull();
	},

	// --- Playback-session persistence (for Exhibition Mode resume) --------------------
	// All saves are best-effort and fully guarded: a persistence hiccup must never disturb
	// playback. See utility/playbacksession.js and the Exhibition standalone-resume path.

	saveSessionFull: function ()
	{
		try
		{
			this.$.PlaybackSession.save(this.$.Playback.getSessionSnapshot());
		}
		catch (err)
		{
			this.log("saveSessionFull error:", err);
		}
	},

	saveSessionProgress: function ()
	{
		try
		{
			if (!this.boolPlaybackListSet) { return; }
			var snap = this.$.Playback.getSessionSnapshot();
			this.$.PlaybackSession.saveProgress(snap.index, snap.position, snap.playing);
		}
		catch (err)
		{
			this.log("saveSessionProgress error:", err);
		}
	},

	// Throttle position writes to db8 to at most once per PROGRESS_SAVE_MS so a per-track
	// tick doesn't hammer the database.
	PROGRESS_SAVE_MS: 7000,
	_lastProgressSaveAt: 0,
	maybeSaveSessionProgress: function ()
	{
		var now = Date.now();
		if (now - this._lastProgressSaveAt < this.PROGRESS_SAVE_MS) { return; }
		this._lastProgressSaveAt = now;
		this.saveSessionProgress();
	},

	onShuffleClick_PlayModeControls: function ()
	{
		this.log("****");
		this.$.Playback.shufflePlaylist();
	},

	onShuffleChanged_Playback: function (sender, boolShuffleOn, intCurrTrack)
	{
		this.log(sender);
		this.log(boolShuffleOn);
		this.$.PlayerControl.setShuffleButton(boolShuffleOn);
		if (this.boolAlbumArtViewDisplay)
		{
			this.$.AlbumArtView.requestTrackList();
		}
		this.updateBroadcaster({type: "shuffleChanged", boolShuffle: boolShuffleOn, intCurrTrack: intCurrTrack});
	},

	onRepeatClick_PlayModeControls: function ()
	{
		this.log("****");
		this.$.Playback.setRepeatMode();
	},

	onRepeatChanged_Playback: function (sender, strRepeatMode, intRepeatMode)
	{
		this.log(sender);
		this.log(strRepeatMode);
		this.$.PlayerControl.setRepeatButton(strRepeatMode);
		this.updateBroadcaster({type: "repeatChanged", intRepeatMode: intRepeatMode});
	},

	onRequestMedia_ListView: function (sender, objGetSongRequest)
	{
		this.log();
		// Show a loading spinner on the requesting list view, hide it when results come
		// back (wrap the request's callback). Safety timeout so it can never get stuck.
		if (sender && sender.setLoading && objGetSongRequest)
		{
			sender.setLoading(true);
			var done = false;
			var hide = function () { if (!done) { done = true; sender.setLoading(false); } };
			var origCb = objGetSongRequest.callback;
			objGetSongRequest.callback = function () {
				hide();
				if (origCb) { return origCb.apply(this, arguments); }
			};
			setTimeout(hide, 12000);
		}

		// Library mode: serve from the db8 cache instead of Apple's API. Dispatch on the
		// request itself (mediaType + where) so list AND detail views filter correctly.
		if (this.libraryMode)
		{
			this._serveLibraryRequest(objGetSongRequest);
			return;
		}

		// Apple Music catalog artist/album DETAIL: use the real catalog id (carried
		// through from listViewDetail.js) to fetch the actual artist->albums->tracks or
		// album->tracks relationships, instead of a blind text search that only ever
		// surfaced a handful of loosely-matching songs.
		if (objGetSongRequest.catalogArtistId || objGetSongRequest.catalogAlbumId)
		{
			var self = this;
			// The pane-slide transition into the detail view and this request both
			// start in the same tick; on this device that competes for the main thread
			// and made the transition itself feel laggy. Let the view fully attach and
			// the animation finish BEFORE kicking off the network calls - the spinner
			// (already showing, above) covers the wait either way.
			setTimeout(function ()
			{
				if (objGetSongRequest.catalogArtistId)
				{
					self.$.MediaIndex.requestCatalogArtistDetail(objGetSongRequest.catalogArtistId, objGetSongRequest);
				}
				else
				{
					self.$.MediaIndex.requestCatalogAlbumDetail(objGetSongRequest.catalogAlbumId, objGetSongRequest);
				}
			}, 2000);
			return;
		}

		this.$.MediaIndex.requestMedia(objGetSongRequest);
	},

	onRequestPlaylists: function (sender, objGetPlaylistsRequest)
	{
		this.log();
		var self = this;
		var idClause = this._findIdClause(objGetPlaylistsRequest && objGetPlaylistsRequest.where);

		// Single-playlist lookup (listViewPlaylist asking for ONE playlist's tracks after
		// the user taps it) - serve from our own cache, which now carries each playlist's
		// real synced tracks (see LibraryCache._syncPlaylistsWithTracks).
		if (idClause)
		{
			this.$.LibraryCache.getPlaylistByRef(idClause.val).then(function (rec)
			{
				var tracks = rec && rec.tracks ? rec.tracks.map(function (t)
				{
					return enyo.mixin(enyo.clone(t), {artUrl: self._libArt(t.artUrl, 480)});
				}) : [];
				var result = rec ? {name: rec.name, tracks: tracks} : null;
				if (objGetPlaylistsRequest.callback)
				{
					objGetPlaylistsRequest.callback({results: result ? [result] : []}, {objGetPlaylistsRequest: objGetPlaylistsRequest});
				}
			}).catch(function (err)
			{
				self.log("library playlist tracks fetch failed", err);
				if (objGetPlaylistsRequest.callback)
				{
					objGetPlaylistsRequest.callback({results: []}, {objGetPlaylistsRequest: objGetPlaylistsRequest});
				}
			});
			return;
		}

		// The nav's "give me all playlists" request has no _id filter - serve THAT from
		// our own library cache too (com.palm.music.staticplaylists, which PlaylistManager
		// reads, is a leftover Palm Music kind we don't own and always permission-denies -
		// this section had been silently empty since day one).
		this.$.LibraryCache.getPlaylists().then(function (records)
		{
			var results = records.map(function (rec)
			{
				return {id: rec.catalogId || rec.libId, name: rec.name, kind: "applemusic", readonly: true};
			});
			if (objGetPlaylistsRequest.callback)
			{
				objGetPlaylistsRequest.callback({results: results}, {objGetPlaylistsRequest: objGetPlaylistsRequest});
			}
		}).catch(function (err)
		{
			self.log("library playlists fetch failed", err);
			if (objGetPlaylistsRequest.callback)
			{
				objGetPlaylistsRequest.callback({results: []}, {objGetPlaylistsRequest: objGetPlaylistsRequest});
			}
		});
	},

	onCreatePlaylist_NavPanel: function (sender, objPutPlaylistsRequest)
	{
		this.log(objPutPlaylistsRequest.strPlaylistName);
		this.$.PlaylistManager.insertStaticPlaylist(objPutPlaylistsRequest);
	},

	onEditPlaylist: function (sender, strEditPlaylistID)
	{
		this.$.navPanel.editPlaylist(strEditPlaylistID);
	},

	onAddToPlaylist: function (sender, objAddToPlaylist)
	{
		this.log();
		this.$.PlaylistManager.addToPlaylist(objAddToPlaylist);
	},

	onUpdatePlaylist: function (sender, objUpdatePlaylist)
	{
		this.log();
		this.$.PlaylistManager.updateStaticPlaylist(objUpdatePlaylist);
	},

	onDeletePlaylist: function (sender, objDeletePlaylist)
	{
		this.log();
		this.$.PlaylistManager.deletePlaylist(objDeletePlaylist);
		this.$.navPanel.playlistDeleted(objDeletePlaylist);
	},

	onPlaylistDeleted: function ()
	{
		this.$.listViewPlaylist.playlistDeleted();
	},

	refreshPlaylists: function ()
	{
		this.$.navPanel.refreshPlaylists();
	},

	onUIListChanged: function (sender, arChangedUIList, intCurrTrackOrigIndex)
	{
		this.$.Playback.songListChanged(intCurrTrackOrigIndex);
	},

	onUIListSorted: function (sender, strSortMode, boolSortAsc)
	{
		this.$.Playback.sortSongList(strSortMode, boolSortAsc);
	},

	onSongChange: function ()
	{
		this.log();
		this.refreshCurrentListView();
		var listViews = ["listViewSongs", "listViewArtists", "listViewAlbums", "listViewGenres", "listViewSongs"];
		var toRender = [];
		for (var i in listViews)
		{
			if (this.$[listViews[i]] !== this.listVeiw)
			{
				toRender.push(listViews[i]);
			}
		}
		setTimeout(enyo.bind(this, "renderListViews", toRender), 1000);
	},

	onPlaylistChange: function ()
	{
		this.log();
		this.refreshPlaylists();
	},

	onIndexingStart: function ()
	{
		this.log();
		this.$.navPanel.setIndexingStatus(true);
		if (this.ListView && this.ListView.resizeList)
		{
			this.log("forcing resize of current list");
			this.ListView.resizeList();
		}
	},

	onIndexingStop: function ()
	{
		this.log();
		this.$.navPanel.setIndexingStatus(false);
		if (this.ListView && this.ListView.resizeList)
		{
			this.log("forcing resize of current list");
			this.ListView.resizeList();
		}
	},

	onSetPlaybackTime: function (sender, intPos)
	{
		this.log();
		this.$.Playback.setTrackTime(intPos);
	},

	setVolumeLock: function (boolVolumeLock)
	{
		this.log(boolVolumeLock);
		try
		{
			if (boolVolumeLock)
			{
				this.$.psSetVolumeLock.call({});
			}
			else
			{
				this.$.psSetVolumeLock.cancel({});
			}
		}
		catch (err)
		{
			this.log("error: " + err);
		}
	},

	// com.palm.audio's media/setVolume is private-bus-only - confirmed via live device
	// testing that a 3rd-party app gets "Unknown method \"setVolume\" for category \"/media\""
	// even on the public bus (the identical call succeeds only on the private bus, which our
	// own app/service roles aren't granted outbound access to either). So there is no way to
	// move the real system volume from here; route through Playback/AudioPlayer instead,
	// which sets OUR OWN PulseAudio stream gain via the Luna service - see
	// JukieAudioService.js's setVolume/_applyVolume.
	onSetPlaybackVolume: function (sender, intPos)
	{
		this.log();
		this.$.Playback.setVolume(intPos);
	},

	onSuccess_VolumeLock: function (sender, response)
	{
		this.log("lockVolumeKeys succeeded:", response);
	},

	onFailure_VolumeLock: function (sender, response)
	{
		this.log("lockVolumeKeys FAILED:", response);
	},

	// Reflects our own AudioPlayer/Luna-service volume into the slider at startup - not
	// com.palm.audio's system volume (see onSetPlaybackVolume for why that's unreachable).
	// Async because the Luna service may already be running (persisted across an app
	// relaunch) with a volume the app doesn't know about yet.
	onRequestSysVolume: function (sender, callback)
	{
		this.log();
		this.$.Playback.getVolume(callback);
	},

	RequestHeadsetStatus: function ()
	{
		this.log();
		if (window.PalmSystem)
		{
			this.$.psHeadsetStatus.call({});
		}
	},

	onSuccess_RequestHeadsetStatus: function (sender, response)
	{
		this.log();
		this.log(response);
		if (response.key === "headset_button" && response.state)
		{
			switch (response.state)
			{
				case "single_click":
					this.playPause();
					break;
				case "double_click":
					this.onClickNext();
					break;
			}
		}
	},

	onFailure_RequestHeadsetStatus: function (sender, response)
	{
		this.log(response);
	},

	RequestAVRCPStatus: function ()
	{
		this.log();
		if (window.PalmSystem)
		{
			this.$.psAVRCPStatus.call({});
		}
	},

	onSuccess_RequestAVRCPStatus: function (sender, response)
	{
		this.log();
		this.log(response);
		if (response.state === "down")
		{
			switch (response.key)
			{
				case "next":
					this.onClickNext();
					break;
				case "prev":
					this.onClickPrev();
					break;
				case "pause":
					this.playPause(false);
					break;
				case "stop":
					this.log("stop not supported");
					this.playPause(false);
					break;
				case "play":
					this.playPause(true);
					break;
				case "nextAndPlay":
					this.log("nextAndPlays not supported");
					break;
				case "togglePausePlay":
					this.log("togglePausePlay");
					this.playPause();
					break;
				case "repeat-all":
					this.$.Playback.setRepeatMode(1);
					break;
				case "repeat-track":
					this.$.Playback.setRepeatMode(2);
					break;
				case "repeat-none":
					this.$.Playback.setRepeatMode(0);
					break;
				case "shuffle-on":
					this.$.Playback.shufflePlaylist(true);
					break;
				case "shuffle-off":
					this.$.Playback.shufflePlaylist(false);
					break;
				default:
					this.log("Unknown AVRCP event: " + response.key);
					break;
			}
		}
	},

	onFailure_RequestAVRCPStatus: function (sender, response)
	{
		this.log(response);
	},

	SONG_CHANGED: "SONG_CHANGED",
	DURATION_CHANGED: "DURATION_CHANGED",
	PLAYLIST_ENDED: "PLAYLIST_ENDED",
	PLAYLIST_STARTED: "PLAYLIST_STARTED",
	SHUFFLE_MODE_CHANGED: "SHUFFLE_MODE_CHANGED",
	REPEAT_MODE_CHANGED: "REPEAT_MODE_CHANGED",
	PAUSE_MODE_CHANGED: "PAUSE_MODE_CHANGED",
	SHUFFLE_MODE_OFF: "OFF",
	SHUFFLE_MODE_ON: "ON",
	REPEAT_MODE_TRACK: "TRACK",
	REPEAT_MODE_ALL: "ALL",
	REPEAT_MODE_OFF: "OFF",
	PAUSE_MODE_OFF: "OFF",
	PAUSE_MODE_ON: "ON",
	AR_REPEAT_MODES: ["OFF", "ALL", "TRACK"],

	updateBroadcaster: function (objBroadCastParams)
	{
		this.log();
		this.log(objBroadCastParams);
		var params = {};
		switch (objBroadCastParams.type)
		{
			case "playChanged":
				params = {event: this.PAUSE_MODE_CHANGED, song: {}};
				params.song.pause = (!objBroadCastParams.boolPlaying) ? this.PAUSE_MODE_ON : this.PAUSE_MODE_OFF;
				break;
			case "trackChanged":
				var objTrack = objBroadCastParams.track;
				params = {
					event: "SONG_CHANGED",
					song: {
						title: objTrack.strTrackTitle,
						artist: objTrack.strTrackArtist,
						album: objTrack.strTrackAlbum,
						genre: objTrack.strTrackGenre,
						currentTime: "" + parseInt(objTrack.intTrackTime, 10),
						duration: "" + parseInt(objTrack.intTrackDuration, 10)
					},
					playlist: {
						currentTrackNumber: "" + (objTrack.intTrackIndex + 1)
					}
				};
				break;
			case "playlistStart":
				params = {
					event: this.PLAYLIST_STARTED,
					playlist: {
						repeat: objBroadCastParams.strRepeat.toUpperCase(),
						shuffle: objBroadCastParams.strShuffle.toUpperCase(),
						numberOfTracks: "" + objBroadCastParams.intTrackCount
					}
				};
				break;
			case "shuffleChanged":
				var strShuffle = (objBroadCastParams.boolShuffle) ? this.SHUFFLE_MODE_ON : this.SHUFFLE_MODE_OFF;
				params = {
					event: this.SHUFFLE_MODE_CHANGED,
					playlist: {
						shuffle: strShuffle,
						currentTrackNumber: "" + (objBroadCastParams.intCurrTrack + 1)
					}
				};
				break;
			case "repeatChanged":
				params = {
					event: this.REPEAT_MODE_CHANGED,
					playlist: {repeat: this.AR_REPEAT_MODES[objBroadCastParams.intRepeatMode]}
				};
				break;
		}
		if (!this.boolBroadcasterAvailable)
		{
			return;
		}

		this.log(params);
		this.$.psUpdateBroadcaster.call(params);
	},

	onSuccess_SetBroadcaster: function (sender, response)
	{
		this.log();
		this.log(response);
	},

	onFailure_SetBroadcaster: function (sender, response)
	{
		this.log();
		this.log(response);
		this.boolBroadcasterAvailable = false;
	},

	onClick_FullScreen: function ()
	{
		if (!this.boolAlbumArtViewDisplay)
		{
			if (this.boolPlaybackListSet)
			{
				this.log();
				this.ListView.boolViewActive = false;
				this.boolAlbumArtViewDisplay = true;
				this.$.paneTop.selectViewByIndex(1, true);
				this.$.AlbumArtView.requestTrackList();
			}
		}
		else
		{
			this.boolAlbumArtViewDisplay = false;
			this.$.paneTop.selectViewByIndex(0, true);
			if (this.ListView)
			{
				this.ListView.boolViewActive = true;
				if (this.ListView.refreshList)
				{
					this.ListView.refreshList();
				}
			}
			this.$.navPanel.resizeContent();
		}
		this.$.PlayerControl.setFullscreen(this.boolAlbumArtViewDisplay);
	},

	onRequestTracks_AlbumArtView: function (sender, callback)
	{
		this.log();
		callback(this.$.Playback.getTrackList(), this.$.Playback.getTrackIndex(), this.$.Playback.getTrackPlaying());
	},

	onClickAlbumArtViewTrack: function (sender, intClickTrackIndex)
	{
		this.log(intClickTrackIndex);
		this.$.Playback.clickTrack(intClickTrackIndex);
	},

	onClick_NowPlaying: function (sender, objParams)
	{
		switch (objParams.strListViewType)
		{
			case "Artists":
				this.onSelectArtistDetail(sender, objParams);
				break;
			case "Albums":
				this.onSelectAlbumDetail(sender, objParams);
				break;
			case "Genres":
				this.onSelectGenreDetail(sender, objParams);
				break;
			default:
				return;
		}
	},

	onClick_ListView: function (sender, strListViewType, objParams)
	{
		this.log();
		this.libraryMode = null;
		this.resetListViewSliderGroup(this.$.paneMainView.getView());
		this.selectListView(strListViewType, objParams);
	},

	onClick_LibraryView: function (sender, strListViewType)
	{
		this.log("library mode:", strListViewType);
		this.libraryMode = strListViewType;
		this.resetListViewSliderGroup(this.$.paneMainView.getView());
		this.selectListView(strListViewType);
	},

	onRefreshLibrary_NavPanel: function ()
	{
		var self = this;
		this.$.refreshScrim.show();
		this.$.LibraryCache.sync().then(function ()
		{
			self.$.refreshScrim.hide();
			if (self.libraryMode && self.ListView && self.ListView.renderList)
			{
				self.ListView.renderList();
			}
		}).catch(function (err)
		{
			self.log("library refresh failed", err);
			self.$.refreshScrim.hide();
		});
	},

	// ---- Just Type (universalSearch dbsearch) launch handling -----------------------
	// appinfo.json's universalSearch.dbsearch lets the system launcher query our db8
	// libitem kind directly (no service call to us) and show matches inline in Just Type.
	// Picking a result launches us with launchParam "libItemId" = that record's _id.

	showLibraryItemById: function (id)
	{
		var self = this;
		this.$.LibraryCache.getById(id).then(function (rec)
		{
			if (!rec)
			{
				self.log("Just Type: no library item for id", id, "- falling back to Library>Songs");
				self.libraryMode = "Songs";
				self.selectListView("Songs");
				return;
			}
			self.showLibraryRecord(rec);
		}).catch(function (err)
		{
			self.log("Just Type: lookup failed", err);
			self.libraryMode = "Songs";
			self.selectListView("Songs");
		});
	},

	showLibraryRecord: function (rec)
	{
		var item;
		switch (rec.itemType)
		{
		case "song":
			// Auto-play: a single-track playback list starting immediately, exactly like
			// tapping the row in the Songs list would (see listViewSongs.onclick_listMedia).
			this.libraryMode = "Songs";
			this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libSongs, false);
			this.selectListView("Songs");
			item = this._libRecordToItem(rec, "song");
			this.onSetPlaybackList(null, {
				arThumbnails: item.artUrl ? [{data: item.artUrl}] : [],
				arSetPlaybackList: [item],
				intStartTrackIndex: 0,
				intStartTrackTime: 0,
				strOriginListID: Utilities.generateGuid(),
				strListType: "Song",
				strListText: item.title,
				strListSubText: item.artist
			});
			break;
		case "album":
			this.libraryMode = "Albums";
			this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libAlbums, false);
			this.onSelectAlbumDetail(null, {name: rec.name, artist: rec.artistName, showParentView: true, boolForceRender: true});
			break;
		case "artist":
			this.libraryMode = "Artists";
			this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libArtists, false);
			this.onSelectArtistDetail(null, {name: rec.name, showParentView: true, boolForceRender: true});
			break;
		default:
			// Playlists aren't deep-linkable yet (they live in a separate playlist
			// mechanism from the libitem cache) - land on the Library Songs list rather
			// than doing nothing or throwing.
			this.libraryMode = "Songs";
			this.$.navPanel.changeSelectedLibrary(this.$.navPanel.$.libSongs, false);
			this.selectListView("Songs");
			break;
		}
	},

	_libArt: function (url, px)
	{
		var p = px || 200;
		return (url || "").replace("{w}", p).replace("{h}", p).replace("{f}", "jpg").replace("{c}", "");
	},

	_libRecordToItem: function (rec, mediaType)
	{
		// Songs need a high-res source: this same artUrl also feeds the full-screen
		// KindAlbumArtView coverflow (480x480), not just the small row icon.
		var artUrl = this._libArt(rec.artworkUrl, mediaType === "song" ? 480 : 200);
		if (mediaType === "song") {
			return {id: rec.catalogId, title: rec.name, artist: rec.artistName, album: rec.albumName, durationMs: rec.durationMs, trackNumber: rec.trackNumber, artUrl: artUrl, libraryId: rec.libId, playable: !!rec.catalogId};
		}
		if (mediaType === "album") {
			return {id: rec.catalogId, name: rec.name, artist: rec.artistName, artUrl: artUrl, trackCount: rec.trackCount, libraryId: rec.libId};
		}
		if (mediaType === "artist") {
			return {id: rec.catalogId, name: rec.name, artUrl: artUrl, albumCount: rec._albumCount || 0, trackCount: rec._trackCount || 0, libraryId: rec.libId};
		}
		return rec;
	},

	// Serve a list/detail media request from the db8 library cache instead of Apple.
	// Dispatches on the request's mediaType + where clauses (the same shape the views
	// already build for the on-device DB), so album/artist DETAIL filtering Just Works.
	_serveLibraryRequest: function (req)
	{
		var self = this;
		var mediaType = req.mediaType || "song";
		var where = req.where || [];
		var fetch;
		if (mediaType === "album") { fetch = this.$.LibraryCache.getAlbums(); }
		else if (mediaType === "artist") { fetch = this._getArtistsWithCounts(); }
		else if (mediaType === "genre") {
			// Genres aren't cached - return empty rather than hitting Apple.
			if (req.callback) { req.callback({results: []}, {objGetMediaRequest: req}); }
			return;
		}
		else { fetch = this.$.LibraryCache.getSongs(); }

		fetch.then(function (records) {
			var items = records.map(function (r) { return self._libRecordToItem(r, mediaType); });
			items = self._filterLibraryItems(items, where, mediaType);
			if (mediaType === "song" && where.length > 0) {
				// Album/artist detail: group by album, then track number.
				items.sort(function (a, b) {
					if (a.album !== b.album) { return (a.album < b.album) ? -1 : 1; }
					return (a.trackNumber || 0) - (b.trackNumber || 0);
				});
			}
			if (req.callback) { req.callback({results: items}, {objGetMediaRequest: req}); }
		}).catch(function (err) {
			self.log("library fetch failed", err);
			if (req.callback) { req.callback({results: []}, {objGetMediaRequest: req}); }
		});
	},

	// Apple's library-artist API (unlike library-albums, which includes trackCount) doesn't
	// return album/song counts for an artist - tally them ourselves from the cache so the
	// Artists list can show real "N albums / N songs" instead of the previous hardcoded 0.
	//
	// MUST run these three fetches SEQUENTIALLY, not via Promise.all: kindDB8 allows only
	// ONE in-flight db8 call at a time and REJECTS a second concurrent call ("a call is
	// already in flight"). Promise.all fires all three in the same tick, so two of the
	// three always collided and rejected - which silently emptied the whole Artists list
	// (the rejection propagated up to _serveLibraryRequest's .catch -> {results: []}).
	_getArtistsWithCounts: function ()
	{
		var self = this, artists, albums;
		return this.$.LibraryCache.getArtists().then(function (a)
		{
			artists = a;
			return self.$.LibraryCache.getAlbums();
		}).then(function (a)
		{
			albums = a;
			return self.$.LibraryCache.getSongs();
		}).then(function (songs)
		{
			var albumCounts = {}, trackCounts = {};
			albums.forEach(function (a) { albumCounts[a.artistName] = (albumCounts[a.artistName] || 0) + 1; });
			songs.forEach(function (s) { trackCounts[s.artistName] = (trackCounts[s.artistName] || 0) + 1; });
			artists.forEach(function (a)
			{
				a._albumCount = albumCounts[a.name] || 0;
				a._trackCount = trackCounts[a.name] || 0;
			});
			return artists;
		});
	},

	// Apply the request's where clauses against already-mapped library items.
	_filterLibraryItems: function (items, where, mediaType)
	{
		var i, clause, val;
		for (i = 0; i < where.length; i++) {
			clause = where[i];
			val = clause.val;
			// album detail filters by album AND artist; skip the artist clause so
			// compilations (album artist != track artist) still return their tracks.
			if (mediaType === "song" && clause.prop === "artist" && this._hasAlbumClause(where)) {
				continue;
			}
			items = this._filterByClause(items, clause);
		}
		return items;
	},

	_hasAlbumClause: function (where)
	{
		var i;
		for (i = 0; i < where.length; i++) {
			if (where[i].prop === "album") { return true; }
		}
		return false;
	},

	_findIdClause: function (where)
	{
		var i;
		if (!where) { return null; }
		for (i = 0; i < where.length; i++) {
			if (where[i].prop === "_id") { return where[i]; }
		}
		return null;
	},

	_filterByClause: function (items, clause)
	{
		var field = {title: "title", artist: "artist", album: "album", name: "name"}[clause.prop];
		if (!field) { return items; }
		var needle = ("" + clause.val);
		var contains = (clause.op === "%");
		var lc = needle.toLowerCase();
		return items.filter(function (it) {
			var hay = "" + (it[field] || "");
			if (contains) { return hay.toLowerCase().indexOf(lc) !== -1; }
			return hay === needle;
		});
	},

	selectListView: function (strListViewType, objParams)
	{
		this.log();
		this.log("strListViewType: " + strListViewType);
		this.log("objParams: " + objParams);
		if (strListViewType === undefined)
		{
			strListViewType = "Songs";
		}
		if (strListViewType === "Playlist")
		{
			this.$.listViewPlaylist.clearPlaylist();
		}
		this.boolAlbumArtViewDisplay = false;
		this.boolExhibitionViewDisplay = false;
		this.$.paneMainView.selectViewByName("viewListView" + strListViewType, true);
		enyo.asyncMethod(this, "setListViews", this.$["listView" + strListViewType], this.ListView, objParams);
	},

	setListViews: function (objView, objPrevView, objParams)
	{
		this.log();
		var wasActive = objView.boolViewActive;
		this.$.listViewSongs.boolViewActive = false;
		this.$.listViewArtists.boolViewActive = false;
		this.$.listViewAlbums.boolViewActive = false;
		this.$.listViewGenres.boolViewActive = false;
		if (objPrevView)
		{
			objPrevView.boolViewActive = false;
		}
		var boolForceRender = false;
		if (objPrevView && !wasActive)
		{
			objPrevView.refreshList();
		}
		if (objParams)
		{
			boolForceRender = objParams.boolForceRender || false;
		}
		if (objView !== undefined)
		{
			if (!objParams || objParams.isActive !== false)
			{
				objView.boolViewActive = true;
				this.ListView = objView;
			}
			if (!boolForceRender && !wasActive)
			{
				if (objView.refreshList !== undefined)
				{
					objView.refreshList(objParams);
				}
			}
			else
			{
				if (objView.renderList !== undefined)
				{
					objView.renderList(objParams);
				}
			}
		}
	},

	refreshCurrentListView: function ()
	{
		this.log();
		if (this.ListView && this.ListView.renderList !== undefined)
		{
			this.ListView.renderList();
		}
	},

	onResetDetailView: function ()
	{
		this.log();
		this.resetListViewSliderGroup(this.$.paneMainView.getView());
	},

	resetListViewSliderGroup: function (slidingPane)
	{
		if (slidingPane && slidingPane.getViewIndex && slidingPane.getViewIndex() > 0)
		{
			if (slidingPane.selectViewByIndex)
			{
				slidingPane.selectViewByIndex(0);
			}
		}
	},

	onSelectArtistDetail: function (sender, obj)
	{
		this.log(obj);
		this.onSelectDetail(sender, obj, "Artist");
	},

	onSelectAlbumDetail: function (sender, obj)
	{
		this.onSelectDetail(sender, obj, "Album");
	},

	onSelectGenreDetail: function (sender, obj)
	{
		this.onSelectDetail(sender, obj, "Genre");
	},

	onSelectDetail: function (sender, obj, strName)
	{
		this.log(obj);
		this.log(strName);
		// Always render the selected item's detail. The detail view is a single reused
		// kind, so the old guard (detailView !== current ListView) skipped re-rendering
		// when you backed out and picked a different album/artist - leaving stale details.
		// onClick_ListView unconditionally clears libraryMode (correct for its OTHER caller,
		// the Apple Music catalog drawer) - but this same detail kind is also reused for
		// Library album/artist rows, so clearing it here silently sent Library detail
		// requests to the Apple catalog search instead of the correctly-sorted local cache.
		// Capture/restore so the detail request sees whatever mode was active on entry.
		var priorLibraryMode = this.libraryMode;
		if (obj.showParentView)
		{
			this.onClick_ListView(sender, strName + "s", {isActive: false});
		}
		this.libraryMode = priorLibraryMode;
		this.$["viewListView" + strName + "s"].selectView(this.$["sldListView" + strName + "Detail"]);
		this.$["listView" + strName + "Detail"].renderList(obj);
		this.ListView = this.$["listView" + strName + "Detail"];
		this.ListView.boolViewActive = true;
	},

	onClickPlaylist_NavPanel: function (sender, objClickPlaylist)
	{
		this.log();
		if (objClickPlaylist)
		{
			objClickPlaylist.boolForceRender = true;
			this.selectListView("Playlist", objClickPlaylist);
		}
	},

	onClick_ExhibitionMode: function ()
	{
		this.log();
		// Manual trigger (AppMenu > Exhibition Mode) - opens the same dock-mode window a
		// real Touchstone dock relaunch would open (see launch/MusicAppLauncher.js's
		// exhibition face). Same {window:"dockMode"} attribute so there's exactly one
		// window type in play - opening it as a plain card here and as dockMode from the
		// dock would leave a stale card that a later dock relaunch would just re-activate
		// instead of upgrading. No physical dock hardware needed to test.
		enyo.windows.activate("exhibition.html", "com.achunt.jukie.exhibition", {}, {window: "dockMode"});
	},

	onClick_btnBackAlbumArtView: function ()
	{
		this.$.paneAll.selectViewByIndex(0, true);
		this.$.paneTop.selectViewByIndex(0, true);
		this.$.btnBack.hide();
		if (this.ListView)
		{
			this.ListView.boolViewActive = true;
			if (this.ListView.refreshList)
			{
				this.ListView.refreshList();
			}
		}
	},

	onItemDrag: function (sender, event)
	{
		this.log();
		this.$.avatartop.applyStyle("-webkit-transform", "translate3d(" + (event.pageX - 100) + "px," + (event.pageY - 125) + "px,0)");
	},

	onItemShowAvatar: function (sender, boolShowAvatar, strDragThumb)
	{
		this.log(boolShowAvatar);
		this.log("strDragThumb: " + strDragThumb);
		if (boolShowAvatar)
		{
			if (strDragThumb !== undefined)
			{
				this.$.imgAvatar.setSrc(strDragThumb);
			}
			this.$.imgContainer.setShowing(strDragThumb !== "");
		}
		this.$.avatartop.setShowing(boolShowAvatar);
	},

	onItemShowAvatarIcon: function (sender, boolShowAvatarIcon)
	{
		this.log(boolShowAvatarIcon);
		this.$.imgAvatarIcon.addRemoveClass("on", boolShowAvatarIcon);
	},

	onError_imgAvatar: function ()
	{
		this.log();
		this.$.imgContainer.setShowing(false);
	}
});