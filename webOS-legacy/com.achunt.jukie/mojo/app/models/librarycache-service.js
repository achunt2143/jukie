/*globals Promise, console */
/*
 * LibraryCacheService - pulls the user's Apple Music library and caches it in db8 as
 * com.achunt.jukie.libitem records, so the Library views can be browsed natively and
 * offline without hitting Apple each time. sync() re-pulls; the get*() methods read
 * straight from db8.
 *
 * Mojo port of the Enyo app's utility/librarycache.js (kindLibraryCache). The enyo.kind
 * shell (published:{appleMusicService,db8}, events:{onSyncDone,onSyncError}) became a
 * plain constructor + assignable onSyncDone/onSyncError callbacks; all sync/query logic
 * is unchanged. Library items store catalogId - the id needed to PLAY them (the "i.xxx"
 * library id won't work for webPlayback).
 */
var LibraryCacheService = function (appleMusicService, db8) {
	this.appleMusicService = appleMusicService;
	this.db8 = db8;
	this.onSyncDone = null;   // assignable: function(payload){}
	this.onSyncError = null;  // assignable: function(payload){}
	this.onProgress = null;   // assignable: function(message){} - drives the sync scrim
};

LibraryCacheService.prototype = {

	KIND: "com.achunt.jukie.libitem:1",
	PAGE: 100,
	PUT_CHUNK: 200,
	FIND_LIMIT: 500,

	log: function () {
		// console.error, not console.log: webOS's syslog bridge only surfaces
		// error-level console calls, and the sync/schema flow is exactly what we need
		// visibility into when the library won't load.
		if (typeof console !== "undefined" && console.error) {
			var parts = [], a = arguments, i;
			for (i = 0; i < a.length; i++) {
				parts.push((typeof a[i] === "object") ? JSON.stringify(a[i]) : ("" + a[i]));
			}
			console.error("[LibraryCache] " + parts.join(" "));
		}
	},

	doSyncDone: function (p) { if (this.onSyncDone) { this.onSyncDone(p || {}); } },
	doSyncError: function (p) { if (this.onSyncError) { this.onSyncError(p || {}); } },
	doProgress: function (msg) { if (this.onProgress) { this.onProgress(msg); } },

	// ---- schema (kind + permissions) ------------------------------------------

	ensureSchema: function () {
		var self = this;
		var kindDef = {
			id: this.KIND,
			owner: "com.achunt.jukie",
			indexes: [
				{ name: "byType", props: [{ name: "itemType" }] },
				{ name: "byTypeName", props: [{ name: "itemType" }, { name: "sortName", collate: "primary" }] },
				{ name: "byLibId", props: [{ name: "libId" }] },
				{ name: "byCatalogId", props: [{ name: "catalogId" }] },
				{ name: "bySortName", props: [{ name: "sortName", collate: "primary" }] }
			]
		};
		// The app's OWN grant only, in this call - Just Type's com.palm.launcher grant is a
		// SEPARATE putPermissions call below (_grantLauncherReadBestEffort), not bundled
		// into this array. webOS 2.x's putPermissions is atomic: an earlier attempt that
		// bundled both grants in one array meant a rejected launcher grant ALSO took down
		// the app's own grant, breaking every library read with "db: permission denied"
		// (exactly the symptom seen on-device). Isolating it means a failure there is
		// harmless/best-effort instead of fatal.
		var perms = [{
			type: "db.kind",
			object: this.KIND,
			caller: "com.achunt.jukie",
			operations: { read: "allow", create: "allow", update: "allow", delete: "allow" }
		}];
		return this.db8.putKind(kindDef)
			.then(function (r) { self.log("putKind ok"); return self.db8.putPermissions(perms); })
			.then(function (r) { self.log("putPermissions ok"); return self._grantLauncherReadBestEffort(); })
			.catch(function (err) { self.log("ensureSchema FAILED:", err); throw err; });
	},

	// Just Type (universalSearch "dbsearch" in appinfo.json) queries this kind directly
	// from the system launcher process, not from our app - it needs its own read grant or
	// the query silently returns nothing. Deliberately isolated from ensureSchema's own
	// putPermissions call above - see that call's comment for why bundling them broke
	// every library read on this webOS build.
	_grantLauncherReadBestEffort: function () {
		var self = this;
		return this.db8.putPermissions([{
			type: "db.kind",
			object: this.KIND,
			caller: "com.palm.launcher",
			operations: { read: "allow" }
		}]).then(function () { self.log("launcher read grant ok (Just Type)"); })
			.catch(function (err) { self.log("launcher read grant failed (Just Type may not work):", err); });
	},

	// ---- sync (Apple -> db8) ---------------------------------------------------

	sync: function () {
		var self = this;
		if (!this.appleMusicService || !this.db8) {
			return Promise.reject(new Error("LibraryCache: appleMusicService/db8 not set"));
		}
		this.log("sync starting");
		return this.ensureSchema()
			.then(function () { self.doProgress("Songs…"); return self._syncType("song", function (l, o) { return self.appleMusicService.getLibrarySongs(l, o); }); })
			.then(function () { self.doProgress("Albums…"); return self._syncType("album", function (l, o) { return self.appleMusicService.getLibraryAlbums(l, o); }); })
			.then(function () { self.doProgress("Artists…"); return self._syncType("artist", function (l, o) { return self.appleMusicService.getLibraryArtists(l, o); }); })
			.then(function () { self.doProgress("Playlists…"); return self._syncPlaylistsWithTracks(); })
			.then(function () {
				self.log("sync done");
				self.doProgress("Finishing…");
				self.doSyncDone({});
				// Fire-and-forget: backfill missing artist artwork in the background.
				// Deliberately NOT awaited - the library is fully usable without it, and
				// on this device each lookup is a separate process spawn, so making the
				// user wait on it would multiply an already-slow sync.
				self.backfillArtistArtwork();
			})
			.catch(function (err) { self.log("sync error", err); self.doSyncError({ error: err }); throw err; });
	},

	// Library-artists never carry artwork; bridge to the CATALOG artist (which does) via
	// one of the artist's own cached SONGS: song catalogId -> catalog song's artist
	// relationship -> catalog artist -> artwork. Only processes artists missing artwork.
	backfillArtistArtwork: function () {
		var self = this;
		var svc = this.appleMusicService;
		if (!svc) { return Promise.resolve(); }
		return Promise.all([this.getArtists(), this.getSongs()]).then(function (all) {
			var artists = all[0], songs = all[1];
			self.log("backfillArtistArtwork: fetched", artists.length, "artists,", songs.length, "songs");
			var songIdByArtist = {};
			songs.forEach(function (s) {
				if (s.catalogId && !songIdByArtist[s.artistName]) { songIdByArtist[s.artistName] = s.catalogId; }
			});
			var missing = artists.filter(function (a) { return !a.artworkUrl; });
			var todo = missing.filter(function (a) { return songIdByArtist[a.name]; });
			if (!todo.length) { self.log("backfillArtistArtwork: nothing to do"); return; }
			self.log("backfillArtistArtwork:", todo.length, "artist(s) missing artwork with a matching song");
			return self._backfillArtistNext(todo, songIdByArtist, 0);
		}).catch(function (err) {
			self.log("backfillArtistArtwork failed to start:", err);
		});
	},

	_backfillArtistNext: function (todo, songIdByArtist, i) {
		var self = this;
		var svc = this.appleMusicService;
		if (i >= todo.length) { self.log("backfillArtistArtwork: done"); return Promise.resolve(); }
		var artist = todo[i];
		var songId = songIdByArtist[artist.name];
		return svc.getSongArtistRef(songId).then(function (songResp) {
			var songData = (songResp && songResp.data && songResp.data[0]) || {};
			var artistRefs = (songData.relationships && songData.relationships.artists && songData.relationships.artists.data) || [];
			if (!artistRefs.length) { return null; }
			return svc.getArtist(artistRefs[0].id);
		}).then(function (artistResp) {
			if (!artistResp) { return; }
			var artistData = (artistResp.data && artistResp.data[0]) || {};
			var artUrl = (artistData.attributes && artistData.attributes.artwork && artistData.attributes.artwork.url) || "";
			if (artUrl) {
				return self.db8.merge({ from: self.KIND, where: [{ prop: "_id", op: "=", val: artist._id }] }, { artworkUrl: artUrl });
			}
		}).catch(function (err) {
			self.log("backfill failed for", artist.name, err);
		}).then(function () {
			return self._backfillArtistNext(todo, songIdByArtist, i + 1);
		});
	},

	_syncType: function (itemType, fetchFn) {
		var self = this;
		return this._fetchAll(fetchFn, itemType.charAt(0).toUpperCase() + itemType.slice(1) + "s").then(function (items) {
			var records = [], i;
			for (i = 0; i < items.length; i++) {
				records.push(self._toRecord(itemType, items[i]));
			}
			self.log("fetched " + records.length + " " + itemType + "(s)");
			if (itemType === "artist") {
				// Carry forward any artworkUrl already backfilled (library-artists never
				// carry artwork; a blind del+put would wipe it and force re-fetching).
				return self.getArtists().then(function (existing) {
					var artworkByLibId = {};
					existing.forEach(function (a) { if (a.artworkUrl) { artworkByLibId[a.libId] = a.artworkUrl; } });
					records.forEach(function (r) {
						if (!r.artworkUrl && artworkByLibId[r.libId]) { r.artworkUrl = artworkByLibId[r.libId]; }
					});
					return self.db8.del({ from: self.KIND, where: [{ prop: "itemType", op: "=", val: itemType }] })
						.then(function () { return self._putChunked(records); });
				});
			}
			return self.db8.del({ from: self.KIND, where: [{ prop: "itemType", op: "=", val: itemType }] })
				.then(function () { return self._putChunked(records); });
		});
	},

	// Playlists get their own step: the list endpoint only returns metadata; each
	// playlist's tracks live behind a separate per-playlist sub-resource. Tracks are
	// stored as a nested `tracks` array on the playlist's own libitem record.
	_syncPlaylistsWithTracks: function () {
		var self = this;
		return this._fetchAll(function (l, o) { return self.appleMusicService.getLibraryPlaylists(l, o); }, "Playlists").then(function (items) {
			var records = [], i;
			for (i = 0; i < items.length; i++) {
				records.push(self._toRecord("playlist", items[i]));
			}
			self.log("fetched " + records.length + " playlist(s), fetching tracks for each");
			return self._fetchTracksForPlaylists(records, 0).then(function () {
				return self.db8.del({ from: self.KIND, where: [{ prop: "itemType", op: "=", val: "playlist" }] })
					.then(function () { return self._putChunked(records); });
			});
		});
	},

	_fetchTracksForPlaylists: function (records, i) {
		var self = this;
		if (i >= records.length) { return Promise.resolve(); }
		var rec = records[i];
		// Each playlist's tracks are a separate process spawn on this device (~0.5-2s
		// each), fetched sequentially, so a library with many playlists can take real
		// minutes. Report per-playlist progress so the scrim shows it's actually moving
		// instead of sitting on "Playlists..." with no feedback for that whole time.
		self.doProgress("Playlists (" + (i + 1) + "/" + records.length + "): " + rec.name);
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

	_fetchPlaylistTracks: function (playlistLibId) {
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

	getPlaylistByRef: function (ref) {
		return this.db8.find({ from: this.KIND, where: [{ prop: "itemType", op: "=", val: "playlist" }] }).then(function (resp) {
			var results = (resp && resp.results) || [];
			for (var i = 0; i < results.length; i++) {
				if (results[i].catalogId === ref || results[i].libId === ref) { return results[i]; }
			}
			return null;
		});
	},

	// label (optional): reports "<label> (N so far)..." after each page, since each
	// page is its own process spawn (~0.5-2s) and a several-hundred-item library
	// takes multiple spawns - without this the scrim sits on one static message for
	// the whole fetch with no sign anything is happening.
	_fetchAll: function (fetchFn, label) {
		var self = this, all = [];
		function page(offset) {
			return fetchFn(self.PAGE, offset).then(function (resp) {
				var data = (resp && resp.data) ? resp.data : [];
				all = all.concat(data);
				if (label) { self.doProgress(label + " (" + all.length + " so far)…"); }
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
			if (i >= records.length) { return Promise.resolve({ results: [] }); }
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

	// db8 find caps each page at 500 rows and returns a `next` token when there are more,
	// so page until exhausted (a 695-song library would otherwise truncate to 500).
	getItems: function (itemType) {
		var self = this, all = [];
		function page(pageToken) {
			var query = { from: self.KIND, where: [{ prop: "itemType", op: "=", val: itemType }], limit: self.FIND_LIMIT };
			if (pageToken) { query.page = pageToken; }
			return self.db8.find(query).then(function (resp) {
				var results = (resp && resp.results) ? resp.results : [];
				all = all.concat(results);
				if (resp && resp.next && results.length >= self.FIND_LIMIT) {
					return page(resp.next);
				}
				return all;
			});
		}
		// Self-heal: if the read is denied (kind/permission got wiped by a reinstall and
		// no sync has re-registered it yet), register the schema and retry once. Reads are
		// otherwise the ONE db8 path that never calls ensureSchema, so a fresh install
		// browsed before its first Refresh would always fail "db: permission denied".
		return page(null).catch(function (err) {
			self.log("getItems(" + itemType + ") find failed, re-ensuring schema:", err);
			all = [];
			return self.ensureSchema().then(function () { return page(null); });
		}).then(function (results) {
			results.sort(function (a, b) {
				return (a.sortName < b.sortName) ? -1 : (a.sortName > b.sortName) ? 1 : 0;
			});
			return results;
		});
	},

	getSongs: function () { return this.getItems("song"); },
	getAlbums: function () { return this.getItems("album"); },
	getArtists: function () { return this.getItems("artist"); },
	getPlaylists: function () { return this.getItems("playlist"); },

	getById: function (id) {
		return this.db8.find({ from: this.KIND, where: [{ prop: "_id", op: "=", val: id }] })
			.then(function (resp) {
				return (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
			});
	},

	// This db8 build rejects count:true inside the query, so count via a full paged scan.
	count: function (itemType) {
		return this.getItems(itemType).then(function (results) {
			return results.length;
		});
	}
};
