/*globals Jukie, JukieListAssistant */
/*
 * AlbumsAssistant - library albums (from the db8 cache). Tapping an album opens its
 * tracks by reusing the Songs scene, filtered by album name (library albums have no
 * catalog id, so we filter the cached library songs, which are playable).
 */
var AlbumsAssistant = function () {
	this.title = "Albums";
	// Jukie.library.getAlbums() already returns rows sorted by sortName, so consecutive
	// rows' first letters are already grouped correctly - see JukieListAssistant.dividers.
	this.dividers = {
		labelCallback: function (item) { return JukieListAssistant.prototype.alphaGroupOf(item.primary); },
		template: "list/group_separator"
	};
};

AlbumsAssistant.prototype = new JukieListAssistant();

AlbumsAssistant.prototype.emptyText = "No albums in your library yet.";

AlbumsAssistant.prototype.fetchRows = function () {
	return Jukie.library.getAlbums();
};

AlbumsAssistant.prototype.toRow = function (rec) {
	// Mojo's #{...} substitution escapes for us; escaping here too double-encodes.
	return { primary: rec.name || "", secondary: rec.artistName || "", thumb: this.thumbUrl(rec.artworkUrl, 80) };
};

AlbumsAssistant.prototype.handleTap = function (rec) {
	this.controller.stageController.pushScene("songs", {
		albumName: rec.name,
		artistName: rec.artistName,
		title: rec.name
	});
};
