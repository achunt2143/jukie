/*globals enyo, $L, event, Utilities, window, PalmSystem, MediaIndex */
enyo.kind(
{
	name: "kindMediaIndex",
	kind: "Component",
	events: {onSetPlaybackList: ""},

	published: {
		appleMusicService: null
	},

	create: function ()
	{
		this.inherited(arguments);
	},

	requestMedia: function (objGetMediaRequest)
	{
		var self = this;
		var svc = this.appleMusicService;
		var term;
		var limit;
		var types;

		if (!objGetMediaRequest || objGetMediaRequest.mediaType === undefined)
		{
			return;
		}

		if (!svc)
		{
			this.log("AppleMusicService reference missing on kindMediaIndex");
			return;
		}

		objGetMediaRequest.results = [];
		limit = objGetMediaRequest.limit || 5;

		if (objGetMediaRequest.mediaType === "song")
		{
			types = ["songs"];
		}
		else if (objGetMediaRequest.mediaType === "album")
		{
			types = ["albums"];
		}
		else if (objGetMediaRequest.mediaType === "artist")
		{
			types = ["artists"];
		}
		else if (objGetMediaRequest.mediaType === "playlist")
		{
			types = ["playlists"];
		}
		else
		{
			this.log("Unsupported mediaType for Apple Music request:", objGetMediaRequest.mediaType);
			return;
		}

		term = this._whereToSearchTerm(objGetMediaRequest.where);
		if (!term)
		{
			term = objGetMediaRequest.searchTerm || objGetMediaRequest.strListText || "";
		}

		if (!term)
		{
			this.log("No search term could be derived from request", objGetMediaRequest);
			if (objGetMediaRequest.callback)
			{
				objGetMediaRequest.callback({ results: [] }, { objGetMediaRequest: objGetMediaRequest });
			}
			return;
		}

		this.log("Apple Music search term:", term);
		svc.searchCatalog(term, limit, types).then(function (response) {
			var mapped = svc.mapSearchResults(response);
			var results = self._pickResultsForType(mapped, objGetMediaRequest.mediaType);
			results = self._postProcessResults(results, objGetMediaRequest);

			var enrich = (objGetMediaRequest.mediaType === "artist") ? self._enrichArtistCounts(results) : Promise.resolve(results);
			return enrich.then(function (finalResults) {
				objGetMediaRequest.results = finalResults;

				if (objGetMediaRequest.mediaType === "song" && Boolean(objGetMediaRequest.boolForcePlay))
				{
					self.playSongs(objGetMediaRequest);
				}

				if (objGetMediaRequest.callback)
				{
					objGetMediaRequest.callback({ results: finalResults }, { objGetMediaRequest: objGetMediaRequest, response: response });
				}
			});
		}).catch(function (err) {
			self.log("Apple Music request failed", err);
			if (svc.emitSignal)
			{
				svc.emitSignal("onAppleMusicError", { error: err });
			}
			if (objGetMediaRequest.callback)
			{
				objGetMediaRequest.callback({ results: [], error: err }, { objGetMediaRequest: objGetMediaRequest });
			}
		});
	},

	// Apple's artist SEARCH results carry no album/song counts at all (unlike our own
	// cached library, where we can just count locally) - mapArtist always left them
	// at 0, so every catalog artist row showed "0 songs". Fetch each result's real
	// albums relationship (the same call the artist detail page already makes) and
	// derive counts from the album attributes it already embeds (trackCount per
	// album) - no need for a further per-album fetch just to count. Only the first
	// page of albums is returned for very prolific artists (Apple paginates past
	// 25), so this can under-count a handful of artists; acceptable for a list badge.
	_enrichArtistCounts: function (artists) {
		var svc = this.appleMusicService;
		if (!svc || !artists.length) { return Promise.resolve(artists); }
		var fetches = artists.map(function (artist) {
			return svc.getArtist(artist.id).then(function (response) {
				var artistData = (response && response.data && response.data[0]) || {};
				var albumRefs = (artistData.relationships && artistData.relationships.albums && artistData.relationships.albums.data) || [];
				artist.albumCount = albumRefs.length;
				artist.trackCount = albumRefs.reduce(function (sum, a) {
					return sum + ((a.attributes && a.attributes.trackCount) || 0);
				}, 0);
				return artist;
			}).catch(function () { return artist; }); // leave mapArtist's 0 defaults on failure
		});
		return Promise.all(fetches);
	},

	// Catalog ARTIST detail: the old path derived a text search term from the artist's
	// NAME and ran it through /search, which only ever surfaced whichever handful of
	// songs happened to text-match - not the artist's real, full discography, and not
	// necessarily using the account's actual entitlements. This fetches the artist's
	// REAL relationships.albums (one call), then each album's full track list (one call
	// per album, in parallel, via getAlbum which already includes relationships.tracks),
	// and flattens into the same {song, album, artist, trackNumber, ...} shape the
	// artist-detail list view expects (grouped by album header, sorted by track number).
	requestCatalogArtistDetail: function (artistId, objGetMediaRequest)
	{
		var self = this;
		var svc = this.appleMusicService;
		if (!svc || !artistId)
		{
			this._emptyResult(objGetMediaRequest);
			return;
		}
		svc.getArtist(artistId).then(function (response)
		{
			var artistData = (response && response.data && response.data[0]) || {};
			var albumRefs = (artistData.relationships && artistData.relationships.albums && artistData.relationships.albums.data) || [];
			var fetches = albumRefs.map(function (ref)
			{
				return svc.getAlbum(ref.id).then(function (albumResp)
				{
					var albumData = (albumResp && albumResp.data && albumResp.data[0]) || ref;
					var albumMapped = svc.mapAlbum(albumData);
					var trackRefs = (albumData.relationships && albumData.relationships.tracks && albumData.relationships.tracks.data) || [];
					return trackRefs.map(function (t)
					{
						var song = svc.mapSong(t);
						song.album = albumMapped.name;
						song.artist = song.artist || albumMapped.artist;
						if (!song.artUrl) { song.artUrl = albumMapped.artUrl; }
						return song;
					});
				}).catch(function (err)
				{
					self.log("catalog album fetch failed for artist detail", ref.id, err);
					return [];
				});
			});
			return Promise.all(fetches);
		}).then(function (perAlbum)
		{
			var flat = [];
			perAlbum.forEach(function (arr) { flat = flat.concat(arr); });
			flat = self._postProcessResults(flat, {});
			// Group by album, then by track number WITHIN that album, in a single
			// compound comparator - sorting twice (once by trackNumber, then again by
			// album) relies on Array.sort being STABLE to preserve the first sort's
			// order for equal album names, which this old engine doesn't guarantee -
			// the second sort was silently scrambling the per-album track order.
			flat.sort(function (a, b) {
				if (a.album !== b.album) { return (a.album < b.album) ? -1 : 1; }
				return (a.trackNumber || 0) - (b.trackNumber || 0);
			});
			self._deliver(objGetMediaRequest, flat);
		}).catch(function (err)
		{
			self.log("catalog artist detail failed", err);
			self._emptyResult(objGetMediaRequest, err);
		});
	},

	// Catalog ALBUM detail: getAlbum already includes relationships.tracks in one call,
	// so this is a straight fetch+map+sort (no N+1 fan-out needed like the artist path).
	requestCatalogAlbumDetail: function (albumId, objGetMediaRequest)
	{
		var self = this;
		var svc = this.appleMusicService;
		if (!svc || !albumId)
		{
			this._emptyResult(objGetMediaRequest);
			return;
		}
		svc.getAlbum(albumId).then(function (albumResp)
		{
			var albumData = (albumResp && albumResp.data && albumResp.data[0]) || {};
			var albumMapped = svc.mapAlbum(albumData);
			var trackRefs = (albumData.relationships && albumData.relationships.tracks && albumData.relationships.tracks.data) || [];
			var songs = trackRefs.map(function (t)
			{
				var song = svc.mapSong(t);
				song.album = albumMapped.name;
				song.artist = song.artist || albumMapped.artist;
				if (!song.artUrl) { song.artUrl = albumMapped.artUrl; }
				return song;
			});
			songs = self._postProcessResults(songs, {order: "trackNumber"});
			self._deliver(objGetMediaRequest, songs);
		}).catch(function (err)
		{
			self.log("catalog album detail failed", err);
			self._emptyResult(objGetMediaRequest, err);
		});
	},

	_deliver: function (objGetMediaRequest, results)
	{
		objGetMediaRequest.results = results;
		if (objGetMediaRequest.callback)
		{
			objGetMediaRequest.callback({results: results}, {objGetMediaRequest: objGetMediaRequest});
		}
	},

	_emptyResult: function (objGetMediaRequest, err)
	{
		if (objGetMediaRequest && objGetMediaRequest.callback)
		{
			objGetMediaRequest.callback({results: [], error: err}, {objGetMediaRequest: objGetMediaRequest});
		}
	},

	_whereToSearchTerm: function (where)
	{
		var parts = [];
		var seen = {};

		(where || []).forEach(function (clause) {
			var val;
			if (!clause || clause.prop === "isRingtone")
			{
				return;
			}
			val = clause.val;
			if (val === undefined || val === null)
			{
				return;
			}
			val = String(val);
			if (!val.length || seen[val])
			{
				return;
			}
			seen[val] = true;
			parts.push(val);
		});

		return parts.join(" ");
	},

	_pickResultsForType: function (mapped, mediaType)
	{
		mapped = mapped || {};

		switch (mediaType)
		{
			case "song":
				return mapped.songs || [];
			case "album":
				return mapped.albums || [];
			case "artist":
				return mapped.artists || [];
			case "playlist":
				return mapped.playlists || [];
			default:
				return [];
		}
	},

	_postProcessResults: function (results, objGetMediaRequest)
	{
		var processed = (results || []).slice(0);
		var self = this;

		processed.forEach(function (item, index) {
			item.origIndex = index;
			if (!item.strTrackImage)
			{
				item.strTrackImage = item.artUrl || "";
			}
			if (!item.arThumbnails)
			{
				item.arThumbnails = item.artUrl ? [{ data: item.artUrl }] : [];
			}
		});

		if (objGetMediaRequest && objGetMediaRequest.order)
		{
			processed.sort(function (a, b) {
				return self._compareByOrder(a, b, objGetMediaRequest.order, !!objGetMediaRequest.desc);
			});
		}

		return processed;
	},

	_compareByOrder: function (a, b, order, desc)
	{
		var av = this._getSortableValue(a, order);
		var bv = this._getSortableValue(b, order);
		var result = 0;

		if (av < bv)
		{
			result = -1;
		}
		else if (av > bv)
		{
			result = 1;
		}

		return desc ? (result * -1) : result;
	},

	_getSortableValue: function (item, order)
	{
		var value = "";
		item = item || {};

		switch (order)
		{
			case "title":
			case "name":
				value = item.title || item.name || "";
				break;
			case "artist":
			case "artistName":
				value = item.artist || "";
				break;
			case "album":
			case "albumName":
				value = item.album || "";
				break;
			case "trackNumber":
			case "track.position":
				value = Number(item.trackNumber || 0);
				break;
			case "genre":
				value = item.genre || "";
				break;
			case "releaseDate":
				value = item.releaseDate || "";
				break;
			default:
				value = item[order] || item.title || item.name || "";
				break;
		}

		if (typeof value === "string")
		{
			value = value.toLowerCase();
		}

		return value;
	},

	onFailure_dbsFindMedia: function (inSender, inResponse)
	{
		this.log(inSender);
		this.log(inResponse);
	},

	playSongs: function (objGetMediaRequest)
	{
		var intStartTrackIndex = 0;
		var firstItem;
		var objSetPlaybackList;

		if (!objGetMediaRequest || !objGetMediaRequest.results || !objGetMediaRequest.results.length)
		{
			return;
		}

		if (objGetMediaRequest.playFirst === false)
		{
			intStartTrackIndex = undefined;
		}

		firstItem = objGetMediaRequest.results[0];

		objSetPlaybackList = {
			arSetPlaybackList: objGetMediaRequest.results,
			intStartTrackIndex: intStartTrackIndex,
			intStartTrackTime: 0,
			strOriginListID: Utilities.generateGuid(),
			strListType: objGetMediaRequest.strListType || "Song",
			strListText: objGetMediaRequest.strListText || objGetMediaRequest.searchTerm || "",
			strListSubText: objGetMediaRequest.strListSubText || "",
			strArtist: objGetMediaRequest.strArtist || firstItem.artist || "",
			arThumbnails: firstItem.artUrl ? [{ data: firstItem.artUrl }] : []
		};

		this.doSetPlaybackList(objSetPlaybackList);
	}
});