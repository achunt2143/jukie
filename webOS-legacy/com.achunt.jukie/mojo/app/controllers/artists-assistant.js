/*globals Jukie, JukieListAssistant */
/*
 * ArtistsAssistant - library artists (from the db8 cache; artwork backfilled by the
 * library sync via the catalog). Tapping an artist opens their library songs by reusing
 * the Songs scene filtered by artist name.
 */
var ArtistsAssistant = function () {
	this.title = "Artists";
	// Jukie.library.getArtists() already returns rows sorted by sortName, so consecutive
	// rows' first letters are already grouped correctly - see JukieListAssistant.dividers.
	this.dividers = {
		labelCallback: function (item) { return JukieListAssistant.prototype.alphaGroupOf(item.primary); },
		template: "list/group_separator"
	};
};

ArtistsAssistant.prototype = new JukieListAssistant();

ArtistsAssistant.prototype.emptyText = "No artists in your library yet.";

ArtistsAssistant.prototype.fetchRows = function () {
	return Jukie.library.getArtists();
};

ArtistsAssistant.prototype.toRow = function (rec) {
	// Mojo's #{...} substitution escapes for us; escaping here too double-encodes.
	return { primary: rec.name || "", secondary: "", thumb: this.thumbUrl(rec.artworkUrl, 80) };
};

ArtistsAssistant.prototype.handleTap = function (rec) {
	this.controller.stageController.pushScene("songs", {
		artistName: rec.name,
		title: rec.name
	});
};
