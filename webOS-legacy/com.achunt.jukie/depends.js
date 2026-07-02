/*globals Utilities, enyo, $L, event, Utilities, window, PalmSystem, MediaIndex, escape */

enyo.depends(
	"source/app.js",
	"css/music.css",
	"css/jukie-theme.css",

	"source/playcontrols.js",
	"source/playmodecontrols.js",
	"source/songinfocontrols.js",
	
	"source/navPanel.js",
	"source/navplaylists.js",

	"controls/itemGrid.js",
	"controls/listView.js",
	"controls/listViewDraggable.js",
	"controls/listViewDetail.js",

	"source/settingsView.js",
	"source/helpView.js",

	"source/listViewSongs.js",
	"source/listViewArtists.js",
	"source/listViewArtistDetail.js",
	"source/listViewAlbums.js",
	"source/listViewAlbumDetail.js",
	"source/listViewGenres.js",
	"source/listViewGenreDetail.js",
	"source/listViewPlaylist.js",
	
	"source/albumartview.js",
	"source/albumartitem.js",
	
	"source/playerControl.js",
	
	"controls/searchinput.js",
	"controls/alphapicker.js",
	"controls/alphapicker.css",
	"controls/listViewHeader.js",
	"controls/listViewHeader.css",
	"controls/mediaItemMenu.js",
	
	"utility/promise-polyfill.js",
	"utility/fetch-polyfill.js",
	"utility/db8.js",
	"utility/librarycache.js",
	"utility/settings.js",
	"utility/mediaindex.js",
	"utility/librarytools.js",
	"utility/playlistmanager.js",
	"utility/applemusicservice.js",
	"utility/audioplayer.js",
	"utility/playback.js",
	"utility/playbacklist.js",
	"utility/utilities.js",
	"utility/dashboardmanager.js",
	
	"dashboard/dashControls.js",
	"dashboard/dashControls.css",
	
	"launch/MusicAppLauncher.js"
);