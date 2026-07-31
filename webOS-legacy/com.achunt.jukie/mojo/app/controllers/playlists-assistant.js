/*globals Jukie, JukieListAssistant */
/*
 * PlaylistsAssistant - library playlists (from the db8 cache). Each playlist record
 * carries its tracks inline (fetched during library sync), so tapping one opens the
 * Songs scene with those stored tracks - no extra network call needed.
 */
var PlaylistsAssistant = function () { this.title = "Playlists"; };

PlaylistsAssistant.prototype = new JukieListAssistant();

PlaylistsAssistant.prototype.emptyText = "No playlists in your library yet.";

PlaylistsAssistant.prototype.fetchRows = function () {
	return Jukie.library.getPlaylists();
};

PlaylistsAssistant.prototype.toRow = function (rec) {
	var n = (rec.tracks && rec.tracks.length) || 0;
	// Mojo's #{...} substitution escapes for us; escaping here too double-encodes.
	return { primary: rec.name || "", secondary: n + (n === 1 ? " song" : " songs"), thumb: this.thumbUrl(rec.artworkUrl, 80) };
};

PlaylistsAssistant.prototype.handleTap = function (rec) {
	this.controller.stageController.pushScene("songs", {
		tracks: rec.tracks || [],
		title: rec.name
	});
};
