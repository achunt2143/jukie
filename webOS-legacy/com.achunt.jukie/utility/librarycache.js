/*globals enyo, Promise */
/*
 * kindLibraryCache - pulls the user's Apple Music library and caches it in db8 as
 * com.achunt.jukie.libitem records, so the Library views can be browsed natively and
 * offline without hitting Apple each time. sync() re-pulls (wired to a Refresh button
 * later); the get*() methods read straight from db8.
 *
 * Library items store playParams.catalogId - that's the id needed to PLAY them via the
 * service (the "i.xxx" library id won't work for webPlayback).
 */
enyo.kind({
	name: "kindLibraryCache",
	kind: "Component",
	published: {
		appleMusicService: null,
		db8: null
	},
	events: {onSyncDone: "", onSyncError: ""},

	KIND: "com.achunt.jukie.libitem:1",
	PAGE: 100,
	PUT_CHUNK: 200, // db8 caps objects-per-put; chunk large libraries

	log: function () {
		if (typeof console !== "undefined" && console.log) {
			var parts = [], a = arguments, i;
			for (i = 0; i < a.length; i++) {
				parts.push((typeof a[i] === "object") ? JSON.stringify(a[i]) : ("" + a[i]));
			}
			console.log("[LibraryCache] " + parts.join(" "));
		}
	},

	// ---- schema (kind + permissions) ------------------------------------------

	// Register the libitem kind and grant ourselves access. Idempotent; safe to call on
	// every launch. Needed because SDK palm-install doesn't process configuration/db.
	ensureSchema: function () {
		var self = this;
		var kindDef = {
			id: this.KIND,
			owner: "com.achunt.jukie",
			indexes: [
				{name: "byType",     props: [{name: "itemType"}]},
				{name: "byTypeName", props: [{name: "itemType"}, {name: "sortName", collate: "primary"}]},
				{name: "byLibId",     props: [{name: "libId"}]},
				{name: "byCatalogId", props: [{name: "catalogId"}]},
				// Dedicated single-field index so Just Type's cross-type db8 `search`
				// (which filters ONLY by sortName, no itemType) has a usable index - the
				// compound byTypeName index above requires itemType as its leftmost field,
				// so a sortName-only query against it errors "no index for query".
				{name: "bySortName", props: [{name: "sortName", collate: "primary"}]}
			]
		};
		var perms = [{
			type: "db.kind",
			object: this.KIND,
			caller: "com.achunt.jukie",
			operations: {read: "allow", create: "allow", update: "allow", delete: "allow"}
		}, {
			// Just Type (universalSearch "dbsearch" in appinfo.json) queries this kind
			// directly from the system launcher process, not from our app - it needs its
			// own read grant or the query silently returns nothing.
			type: "db.kind",
			object: this.KIND,
			caller: "com.palm.launcher",
			operations: {read: "allow"}
		}];
		// putKind FIRST (an app can always register its own kind), THEN putPermissions.
		// (putPermissions-first only worked here because the configurator pre-registered
		// this kind from configuration/db/kinds/; a brand-new kind needs putKind first.)
		return this.db8.putKind(kindDef)
			.then(function () { return self.db8.putPermissions(perms); })
			.catch(function (err) { self.log("ensureSchema warning:", err); });
	},

	// ---- sync (Apple -> db8) ---------------------------------------------------

	sync: function () {
		var self = this;
		if (!this.appleMusicService || !this.db8) {
			return Promise.reject(new Error("LibraryCache: appleMusicService/db8 not set"));
		}
		this.log("sync starting");
		return this.ensureSchema()
			.then(function () { return self._syncType("song",     function (l, o) { return self.appleMusicService.getLibrarySongs(l, o); }); })
			.then(function () { return self._syncType("album",    function (l, o) { return self.appleMusicService.getLibraryAlbums(l, o); }); })
			.then(function () { return self._syncType("artist",   function (l, o) { return self.appleMusicService.getLibraryArtists(l, o); }); })
			.then(function () { return self._syncPlaylistsWithTracks(); })
			.then(function ()
			{
				self.log("sync done");
				self.doSyncDone({});
				// Fire-and-forget: backfill missing artist artwork in the background.
				// Deliberately NOT awaited/chained - sync is considered done and the UI
				// unblocks immediately; artist rows quietly gain artwork as each lookup
				// resolves. Safe now that kindDB8 queues concurrent calls instead of
				// rejecting them, so this can't collide with whatever the user does next.
				self.backfillArtistArtwork();
			})
			.catch(function (err) { self.log("sync error", err); self.doSyncError({error: err}); throw err; });
	},

	// Apple's library-artists API never returns artwork (confirmed by inspecting a raw
	// response - attributes only ever has `name`). Bridge to the CATALOG artist (which
	// does have artwork) via one of the artist's own cached SONGS - confirmed via a raw
	// library-album API response that ALBUMS do NOT carry a usable catalogId (their
	// playParams only has {id, isLibrary, kind}, no real catalog id like songs get) -
	// so: song catalogId -> catalog song's artist relationship -> catalog artist ->
	// artwork. Only processes artists that don't already have artworkUrl cached, so
	// repeat syncs only pay for whatever's still missing.
	backfillArtistArtwork: function ()
	{
		var self = this;
		var svc = this.appleMusicService;
		if (!svc) { return Promise.resolve(); }
		return Promise.all([this.getArtists(), this.getSongs()]).then(function (all)
		{
			var artists = all[0], songs = all[1];
			self.log("backfillArtistArtwork: fetched", artists.length, "artists,", songs.length, "songs");
			var songIdByArtist = {};
			songs.forEach(function (s)
			{
				if (s.catalogId && !songIdByArtist[s.artistName]) { songIdByArtist[s.artistName] = s.catalogId; }
			});
			self.log("backfillArtistArtwork: song-artist map has", Object.keys(songIdByArtist).length, "names");
			var missing = artists.filter(function (a) { return !a.artworkUrl; });
			var todo = missing.filter(function (a) { return songIdByArtist[a.name]; });
			if (!todo.length) { self.log("backfillArtistArtwork: nothing to do (0 name matches, " + missing.length + " missing artwork)"); return; }
			self.log("backfillArtistArtwork:", todo.length, "artist(s) missing artwork with a matching song");
			return self._backfillArtistNext(todo, songIdByArtist, 0);
		}).catch(function (err)
		{
			self.log("backfillArtistArtwork failed to start:", err);
		});
	},

	_backfillArtistNext: function (todo, songIdByArtist, i)
	{
		var self = this;
		var svc = this.appleMusicService;
		if (i >= todo.length) { self.log("backfillArtistArtwork: done"); return Promise.resolve(); }
		var artist = todo[i];
		var songId = songIdByArtist[artist.name];
		return svc.getSongArtistRef(songId).then(function (songResp)
		{
			var songData = (songResp && songResp.data && songResp.data[0]) || {};
			var artistRefs = (songData.relationships && songData.relationships.artists && songData.relationships.artists.data) || [];
			if (!artistRefs.length) { return null; }
			return svc.getArtist(artistRefs[0].id);
		}).then(function (artistResp)
		{
			if (!artistResp) { return; }
			var artistData = (artistResp.data && artistResp.data[0]) || {};
			var artUrl = (artistData.attributes && artistData.attributes.artwork && artistData.attributes.artwork.url) || "";
			if (artUrl)
			{
				return self.db8.merge({from: self.KIND, where: [{prop: "_id", op: "=", val: artist._id}]}, {artworkUrl: artUrl});
			}
		}).catch(function (err)
		{
			self.log("backfill failed for", artist.name, err);
		}).then(function ()
		{
			return self._backfillArtistNext(todo, songIdByArtist, i + 1);
		});
	},

	_syncType: function (itemType, fetchFn) {
		var self = this;
		return this._fetchAll(fetchFn).then(function (items) {
			var records = [], i;
			for (i = 0; i < items.length; i++) {
				records.push(self._toRecord(itemType, items[i]));
			}
			self.log("fetched " + records.length + " " + itemType + "(s)");
			if (itemType === "artist") {
				// Apple's library-artists response never carries artwork, so a blind
				// del+put here would silently wipe out everything backfillArtistArtwork
				// fetched (and force re-fetching every artist's artwork on every single
				// refresh). Carry forward any artworkUrl we've already backfilled, keyed
				// by the stable library id.
				return self.getArtists().then(function (existing) {
					var artworkByLibId = {};
					existing.forEach(function (a) { if (a.artworkUrl) { artworkByLibId[a.libId] = a.artworkUrl; } });
					records.forEach(function (r) {
						if (!r.artworkUrl && artworkByLibId[r.libId]) { r.artworkUrl = artworkByLibId[r.libId]; }
					});
					return self.db8.del({from: self.KIND, where: [{prop: "itemType", op: "=", val: itemType}]})
						.then(function () { return self._putChunked(records); });
				});
			}
			// Replace existing rows of this type, then store the fresh set.
			return self.db8.del({from: self.KIND, where: [{prop: "itemType", op: "=", val: itemType}]})
				.then(function () { return self._putChunked(records); });
		});
	},

	// Playlists get their own sync step (not the generic _syncType) because the
	// library-playlists LIST endpoint only returns metadata - each playlist's actual
	// SONGS live behind a separate per-playlist sub-resource that has to be fetched one
	// playlist at a time. Tracks are stored as a nested `tracks` array directly on the
	// playlist's own libitem record (db8 is a JSON document store, so this is natural -
	// no separate itemType/relational querying needed), matching the shape
	// listViewPlaylist.js already expects (`playlist.tracks`).
	_syncPlaylistsWithTracks: function ()
	{
		var self = this;
		return this._fetchAll(function (l, o) { return self.appleMusicService.getLibraryPlaylists(l, o); }).then(function (items) {
			var records = [], i;
			for (i = 0; i < items.length; i++) {
				records.push(self._toRecord("playlist", items[i]));
			}
			self.log("fetched " + records.length + " playlist(s), fetching tracks for each");
			return self._fetchTracksForPlaylists(records, 0).then(function () {
				return self.db8.del({from: self.KIND, where: [{prop: "itemType", op: "=", val: "playlist"}]})
					.then(function () { return self._putChunked(records); });
			});
		});
	},

	// Sequential (not parallel) - keeps Apple API load modest and matches the rest of
	// this file's serial-fetch convention; a handful of playlists is fast enough that a
	// blocking sync (vs a fire-and-forget background job like artist artwork) is fine -
	// unlike artwork, an EMPTY playlist right after a refresh would look like a bug.
	_fetchTracksForPlaylists: function (records, i)
	{
		var self = this;
		if (i >= records.length) { return Promise.resolve(); }
		var rec = records[i];
		return this._fetchPlaylistTracks(rec.libId).then(function (items) {
			rec.tracks = items.map(function (it, idx) {
				var ref = self._toTrackRef(it);
				ref.trackNumber = idx + 1;
				return ref;
			});
			self.log("  " + rec.name + ": " + rec.tracks.length + " track(s)");
		}).catch(function (err) {
			self.log("  failed to fetch tracks for playlist", rec.name, err);
			rec.tracks = [];
		}).then(function () {
			return self._fetchTracksForPlaylists(records, i + 1);
		});
	},

	_fetchPlaylistTracks: function (playlistLibId)
	{
		var self = this, all = [];
		function page(offset) {
			return self.appleMusicService.getLibraryPlaylistTracks(playlistLibId, 100, offset).then(function (resp) {
				var data = (resp && resp.data) ? resp.data : [];
				all = all.concat(data);
				if (resp && resp.next && data.length > 0) {
					return page(offset + data.length);
				}
				return all;
			});
		}
		return page(0);
	},

	// Lean per-track shape for a playlist's nested `tracks` array - just what
	// listViewPlaylist.js's _normalizeSongForView needs to display + play a row.
	// Playlist tracks are library-song-shaped API items, same as /me/library/songs,
	// so this mirrors _toRecord's song-field mapping (catalogId IS present here, unlike
	// library albums - confirmed playback works the same way as the main Songs list).
	_toTrackRef: function (it) {
		var a = it.attributes || {};
		var pp = a.playParams || {};
		return {
			id: pp.catalogId || pp.reportingId || "",
			title: a.name || "",
			artist: a.artistName || "",
			album: a.albumName || "",
			artUrl: (a.artwork && a.artwork.url) || "",
			trackNumber: a.trackNumber || 0,
			durationMs: a.durationInMillis || 0,
			libraryId: it.id || ""
		};
	},

	// Look up a single playlist by the ref value we hand out as its "id" elsewhere
	// (catalogId || libId - playlists have no catalogId, same as albums, so this is
	// really always libId in practice, but check both for consistency with how the
	// nav's playlist list builds its ids).
	getPlaylistByRef: function (ref) {
		return this.db8.find({from: this.KIND, where: [{prop: "itemType", op: "=", val: "playlist"}]}).then(function (resp) {
			var results = (resp && resp.results) || [];
			for (var i = 0; i < results.length; i++) {
				if (results[i].catalogId === ref || results[i].libId === ref) { return results[i]; }
			}
			return null;
		});
	},

	// Page through a paginated library endpoint until there's no `next`.
	_fetchAll: function (fetchFn) {
		var self = this, all = [];
		function page(offset) {
			return fetchFn(self.PAGE, offset).then(function (resp) {
				var data = (resp && resp.data) ? resp.data : [];
				all = all.concat(data);
				if (resp && resp.next && data.length > 0) {
					return page(offset + data.length);
				}
				return all;
			});
		}
		return page(0);
	},

	_putChunked: function (records) {
		var self = this, i = 0;
		function next() {
			if (i >= records.length) { return Promise.resolve({results: []}); }
			var slice = records.slice(i, i + self.PUT_CHUNK);
			i += self.PUT_CHUNK;
			return self.db8.put(slice).then(next);
		}
		return next();
	},

	_toRecord: function (itemType, it) {
		var a = it.attributes || {};
		var pp = a.playParams || {};
		return {
			_kind: this.KIND,
			itemType: itemType,
			libId: it.id || "",
			catalogId: pp.catalogId || pp.reportingId || "",
			name: a.name || "",
			sortName: (a.name || "").toLowerCase(),
			artistName: a.artistName || "",
			albumName: a.albumName || "",
			durationMs: a.durationInMillis || 0,
			trackNumber: a.trackNumber || 0,
			discNumber: a.discNumber || 0,
			trackCount: a.trackCount || 0,
			genre: (a.genreNames && a.genreNames[0]) ? a.genreNames[0] : "",
			artworkUrl: (a.artwork && a.artwork.url) ? a.artwork.url : ""
		};
	},

	// ---- queries (db8 -> views) ------------------------------------------------

	// Fetch ALL records of a type. db8 find caps each page at 500 rows and returns a
	// `next` page token when there are more - so we page until it's exhausted (otherwise
	// a 695-song library silently truncates to 500).
	FIND_LIMIT: 500,
	getItems: function (itemType) {
		var self = this, all = [];
		function page(pageToken) {
			var query = {from: self.KIND, where: [{prop: "itemType", op: "=", val: itemType}], limit: self.FIND_LIMIT};
			if (pageToken) { query.page = pageToken; }
			return self.db8.find(query).then(function (resp) {
				var results = (resp && resp.results) ? resp.results : [];
				all = all.concat(results);
				// Page only while we got a FULL page and have a next token (a short page
				// means we've reached the end, even if a stale next token comes back).
				if (resp && resp.next && results.length >= self.FIND_LIMIT) {
					return page(resp.next);
				}
				return all;
			});
		}
		return page(null).then(function (results) {
			results.sort(function (a, b) {
				return (a.sortName < b.sortName) ? -1 : (a.sortName > b.sortName) ? 1 : 0;
			});
			return results;
		});
	},

	getSongs:   function () { return this.getItems("song"); },
	getAlbums:  function () { return this.getItems("album"); },
	getArtists: function () { return this.getItems("artist"); },
	getPlaylists: function () { return this.getItems("playlist"); },

	// Look up a single record by its db8 _id - used by the Just Type (universalSearch
	// dbsearch) launch path: the system launcher hands us back the _id of whatever
	// libitem row the user picked.
	getById: function (id) {
		return this.db8.find({from: this.KIND, where: [{prop: "_id", op: "=", val: id}]})
			.then(function (resp) {
				return (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
			});
	},

	// Row count of a type. This db8 build rejects count:true inside the query, so we
	// fetch ids (one full paged scan) and count them. Cheap enough for a library.
	count: function (itemType) {
		return this.getItems(itemType).then(function (results) {
			return results.length;
		});
	}
});
