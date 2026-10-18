/*globals Mojo, Jukie, JukieListAssistant, Promise */
/*
 * SongsAssistant - a track list. With no scene args it lists the whole library (from the
 * db8 cache). With args it lists a subset, so albums/artists/playlists reuse this one
 * scene for their track detail:
 *   pushScene('songs', {tracks: [...], title})     - a playlist's stored tracks
 *   pushScene('songs', {albumId, title})           - a catalog album's tracks (network)
 *   pushScene('songs', {artistName, title})        - the library's songs by that artist
 *
 * Tapping a row loads the track into the playback service (full-track via jukie-drm,
 * keyed by catalogId) and opens Now Playing. This is the core end-to-end path the whole
 * Pre2/2.x effort exists to prove: browse -> tap -> service -> jukie-drm -> decrypt ->
 * gst playback of the decrypted .m4a.
 */
var SongsAssistant = function (args) {
	this.args = args || {};
	this.title = this.args.title || "Songs";
	// "Saved Offline": swipe a row to remove it from the device (see deleteRecord).
	this.swipeToDelete = !!this.args.offline;
	if (this.args.artistName) {
		// Artist detail: group by album instead of alphabet - fetchRows below sorts by
		// album name (then disc/track number) so consecutive rows share a group.
		this.dividers = {
			labelCallback: function (item) { return item.album || ""; },
			template: "list/group-header"
		};
	} else if (!this.args.tracks && !this.args.albumId && !this.args.albumName && !this.args.offline) {
		// Whole-library Songs list (no args at all): alphabetical, same as
		// Albums/Artists - Jukie.library.getSongs() already returns rows sorted by
		// sortName, so consecutive rows' first letters are already grouped correctly.
		this.dividers = {
			labelCallback: function (item) { return JukieListAssistant.prototype.alphaGroupOf(item.primary); },
			template: "list/group_separator"
		};
	}
};

SongsAssistant.prototype = new JukieListAssistant();

SongsAssistant.prototype.emptyText = "No songs here.";

// Rows show (and repaint on changes to) offline availability - see JukieListAssistant.
SongsAssistant.prototype.usesOfflineState = true;

SongsAssistant.prototype.fetchRows = function () {
	var self = this;
	if (this.args.offline) {
		// "Saved Offline": the songs the user chose to keep, straight from the service's
		// manifest (so it also lists saved songs that aren't in the synced library).
		this.emptyText = "No songs saved for offline play yet. Press and hold a song, then choose Save for offline.";
		return new Promise(function (resolve) {
			Jukie.playback.listOffline(function (res) {
				var items = (res && res.items) || [];
				items.sort(function (a, b) {
					var x = (a.title || "").toLowerCase(), y = (b.title || "").toLowerCase();
					return x < y ? -1 : (x > y ? 1 : 0);
				});
				resolve(items.map(function (it) {
					// title/artist/album come back from the service in emoji-marker form: show what this device can draw.
					return { catalogId: it.id || "", libraryId: it.libraryId || "", title: JukieEmoji.text(it.title || ""), artist: JukieEmoji.text(it.artist || ""), album: JukieEmoji.text(it.album || ""), artUrl: it.artUrl || "", durationMs: 0 };
				}));
			});
		});
	}
	if (this.args.tracks) {
		return Promise.resolve((this.args.tracks || []).map(function (t) { return self._fromTrackRef(t); }));
	}
	if (this.args.albumId) {
		return Jukie.apple.getAlbum(this.args.albumId).then(function (resp) {
			var album = (resp && resp.data && resp.data[0]) || {};
			var tracks = (album.relationships && album.relationships.tracks && album.relationships.tracks.data) || [];
			return tracks.map(function (it) { return self._fromCatalogItem(it); });
		});
	}
	if (this.args.albumName) {
		// Library albums carry no catalog id (confirmed in the Enyo librarycache), so an
		// album's tracks come from filtering the cached library SONGS (which DO have a
		// catalogId, hence are playable) by album name, optionally narrowed by artist.
		var album = this.args.albumName, albArtist = this.args.artistName;
		return Jukie.library.getSongs().then(function (songs) {
			return songs.filter(function (s) {
				return s.albumName === album && (!albArtist || s.artistName === albArtist);
			}).sort(function (a, b) {
				return (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber);
			}).map(function (s) { return self._fromLibItem(s); });
		});
	}
	if (this.args.artistName) {
		var name = this.args.artistName;
		return Jukie.library.getSongs().then(function (songs) {
			// Sorted by album (then disc/track number) rather than left alphabetical -
			// this scene's dividers (see the constructor) group by album, which only
			// looks right if same-album tracks are actually consecutive.
			return songs.filter(function (s) { return s.artistName === name; })
				.sort(function (a, b) {
					return (a.albumName < b.albumName) ? -1 : (a.albumName > b.albumName) ? 1 :
						(a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber);
				})
				.map(function (s) { return self._fromLibItem(s); });
		});
	}
	return Jukie.library.getSongs().then(function (songs) {
		return songs.map(function (s) { return self._fromLibItem(s); });
	});
};

// Normalize the three source shapes to one playable descriptor.
SongsAssistant.prototype._fromLibItem = function (s) {
	return { catalogId: s.catalogId || "", libraryId: s.libId || "", title: s.name || "", artist: s.artistName || "", album: s.albumName || "", artUrl: s.artworkUrl || "", durationMs: s.durationMs || 0 };
};
SongsAssistant.prototype._fromTrackRef = function (t) {
	return { catalogId: t.id || "", libraryId: t.libraryId || "", title: t.title || "", artist: t.artist || "", album: t.album || "", artUrl: t.artUrl || "", durationMs: t.durationMs || 0 };
};
SongsAssistant.prototype._fromCatalogItem = function (it) {
	var a = it.attributes || {};
	return { catalogId: it.id || "", libraryId: "", title: a.name || "", artist: a.artistName || "", album: a.albumName || "", artUrl: (a.artwork && a.artwork.url) || "", durationMs: a.durationInMillis || 0 };
};

SongsAssistant.prototype.toRow = function (rec) {
	// No escapeHTML here: Mojo's #{...} template substitution already HTML-escapes.
	// Escaping first produced double-encoded rows ("Tiesto &amp; Tate McRae").
	// album: only read by the artist-detail dividers' labelCallback (see the
	// constructor) - unused by media-row.html's own template, harmless elsewhere.
	var decor = Jukie.offlineDecor(rec.catalogId);
	return {
		primary: JukieEmoji.text(rec.title || ""), secondary: JukieEmoji.text(rec.artist || ""), thumb: this.thumbUrl(rec.artUrl, 80), album: rec.album || "",
		rowClass: decor.rowClass, badgeClass: decor.badgeClass
	};
};

SongsAssistant.prototype.alert = function (title, message) {
	this.controller.showAlertDialog({ title: title, message: message, choices: [{ label: "OK", value: "ok" }] });
};

// Press and hold a song: save it for offline play, or remove it from there.
SongsAssistant.prototype.holdActionsFor = function (rec) {
	if (!rec.catalogId) { return null; }
	if (Jukie.savedIds[rec.catalogId]) { return [{ label: "Remove from offline", command: "unsave" }]; }
	return [{ label: "Save for offline", command: "save" }];
};

SongsAssistant.prototype.onHoldChoice = function (command, rec) {
	var self = this;
	if (command === "save") {
		// Downloading needs a connection; a song already cached on the device doesn't.
		if (!Jukie.online && !Jukie.offlineIds[rec.catalogId]) {
			this.alert("You're offline", "Connect to the internet to save this song for offline play.");
			return;
		}
		Jukie.saveOffline(rec);
	} else if (command === "unsave") {
		Jukie.removeOffline(rec, function () { if (self.args.offline) { self.load(); } });
	}
};

// Swiped away in the Saved Offline list: unpin it and delete its audio. The row is already
// gone locally; reload afterwards so the list reflects what the service actually kept.
SongsAssistant.prototype.deleteRecord = function (rec) {
	var self = this;
	Jukie.removeOffline(rec, function () { self.load(); });
};

SongsAssistant.prototype.handleTap = function (rec, index) {
	if (!rec.catalogId) {
		this.alert("Can't play this track", "This item has no catalog id, so full-track playback isn't available for it.");
		return;
	}
	if (!Jukie.isPlayable(rec)) {
		this.alert("Not available offline", "This song isn't saved on this device. Connect to the internet to play it, or press and hold it to save it for offline play.");
		return;
	}
	// Whatever list this is (whole library, an album, an artist, a playlist) becomes the
	// play queue, so Now Playing's prev/next walk the same order shown on screen.
	Jukie.setQueue(this._records, index);
	Jukie.playAt(index, 1);
	this.controller.stageController.pushScene("nowplaying");
};
