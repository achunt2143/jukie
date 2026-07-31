/*globals window, fetch, Promise, WebToken, console */
/*
 * AppleMusicService - client-side wrapper over the Apple Music REST API (catalog +
 * personal library + search). Mojo port of the Enyo app's utility/applemusicservice.js.
 *
 * The Enyo version was an enyo.Component with published tokens and enyo events; this
 * port is a plain constructor taking {developerToken, musicUserToken, storefront, debug}
 * and using the file's own tiny on()/emitSignal listener mechanism for notifications.
 * All request/library/catalog/search/mapping logic is otherwise unchanged - the actual
 * HTTP surface (fetch, Origin header for the AMPWebPlay token, 401 auto-refresh via
 * WebToken) is identical to the working Enyo app.
 */
var AppleMusicService = function (opts) {
	opts = opts || {};
	this.developerToken = opts.developerToken || "";
	this.musicUserToken = opts.musicUserToken || "";
	this.storefront = opts.storefront || "us";
	this.debug = !!opts.debug;

	// Guards against ensureDeveloperToken() overlapping itself.
	this._refreshInFlight = null;
	this._listeners = {};
};

AppleMusicService.prototype = {

	API_BASE: "https://api.music.apple.com/v1",

	// ---- published-prop setters (were enyo auto-generated) ------------------
	setDeveloperToken: function (t) { this.developerToken = t || ""; },
	setMusicUserToken: function (t) { this.musicUserToken = t || ""; },
	setStorefront: function (s) { this.storefront = s || "us"; },

	// ---- tiny listener mechanism (unchanged from the Enyo file) -------------
	on: function (signal, fn) {
		if (!this._listeners[signal]) {
			this._listeners[signal] = [];
		}
		this._listeners[signal].push(fn);
	},

	// Both build ONE string and make a single console call, rather than
	// console.log.apply(console, [...]) - confirmed on-device that webOS's
	// console->syslog bridge silently drops every argument past the first that way.
	_fmt: function (prefix, args) {
		var parts = [prefix];
		var i;
		for (i = 0; i < args.length; i++) {
			parts.push((typeof args[i] === "object") ? JSON.stringify(args[i]) : ("" + args[i]));
		}
		return parts.join(" ");
	},

	log: function () {
		if (this.debug && typeof console !== "undefined" && console.log) {
			console.log(this._fmt("[AppleMusicService]", arguments));
		}
	},

	error: function () {
		if (typeof console !== "undefined" && console.error) {
			console.error(this._fmt("[AppleMusicService]", arguments));
		}
	},

	emitSignal: function (signal, payload) {
		var fns = this._listeners[signal];
		var i;
		if (!fns) {
			return;
		}
		for (i = 0; i < fns.length; i++) {
			try {
				fns[i](payload || {});
			} catch (err) {
				this.error("listener for " + signal + " threw", err);
			}
		}
	},

	// doReady/doError were enyo events; here they route through emitSignal.
	doReady: function (p) { this.emitSignal("onReady", p); },
	doError: function (p) { this.emitSignal("onError", p); },

	ready: function () {
		if (!this.developerToken) {
			this.error("missing developerToken - catalog requests will fail");
			this.doError({ error: new Error("Missing Apple Music developer token") });
			return false;
		}
		this.doReady({});
		return true;
	},

	// No-op on webOS 2.x. The Enyo/3.x app scrapes music.apple.com from the browser
	// to auto-refresh the public web token, but this device's WebKit can't reach
	// Apple over TLS at all (see request() below), so that scrape can never succeed
	// here. Token refresh instead happens inside jukie-drm, which has its own modern
	// TLS stack and already runs EnsureWebToken on every API call it proxies - so by
	// the time a response comes back, the token has been refreshed if it needed to be.
	// Kept as a resolving stub so the shared bootstrap/caller code is unchanged.
	ensureDeveloperToken: function (force) {
		return Promise.resolve(this.developerToken);
	},

	_buildQuery: function (params) {
		var parts = [];
		var key;
		if (!params) {
			return "";
		}
		for (key in params) {
			if (params.hasOwnProperty(key) && params[key] !== undefined && params[key] !== null) {
				parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
			}
		}
		return parts.join("&");
	},

	// Every API request is proxied through the Luna service (which shells out to
	// jukie-drm) rather than being fetched in-page.
	//
	// This is NOT a stylistic choice - it's forced by the platform. webOS 2.x's
	// WebKit cannot complete a TLS handshake with Apple's servers: an on-device
	// probe matrix showed plain https:// to other hosts returning 200 while every
	// Apple host failed with status=0/readyState=4, matching the device's system
	// curl (OpenSSL 0.9.8k), which fails the same way. It isn't CORS and it isn't
	// forbidden headers - both were ruled out by the same probes - and Prototype's
	// Ajax.Request is the same XHR underneath, so it fails identically (it just
	// reports status 0 as "success" with an empty body, which is worse). jukie-drm
	// carries its own modern TLS stack plus an embedded CA bundle, so it can reach
	// Apple from this exact device - proven by the full DRM playback path.
	//
	// Credentials live in the service's secrets file (put there by Preferences via
	// setCredentials), so no tokens are sent over the bus here.
	//
	// The Enyo/webOS 3.x app keeps calling fetch() directly - its WebKit is new
	// enough - so this divergence is deliberate and 2.x-specific.
	request: function (path, params) {
		var self = this;
		var query = this._buildQuery(params);
		var url = this.API_BASE + path + (query ? ("?" + query) : "");

		this.log("GET (via service)", url);

		return new Promise(function (resolve, reject) {
			new Mojo.Service.Request("palm://com.achunt.jukie.service/", {
				method: "apiGet",
				parameters: { path: url },
				onSuccess: function (response) {
					if (response && response.returnValue !== false && response.json) {
						resolve(response.json);
						return;
					}
					reject(new Error(self._apiError(response, url)));
				},
				onFailure: function (response) {
					reject(new Error(self._apiError(response, url)));
				}
			});
		}).catch(function (err) {
			self.error("request failed", url, err);
			self.emitSignal("onAppleMusicError", { error: err });
			throw err;
		});
	},

	// Prefer Apple's own error text when the proxy managed to read a response body -
	// "Authentication required for request" is a lot more actionable than "exit 1".
	_apiError: function (response, url) {
		var errs = response && response.json && response.json.errors;
		if (errs && errs.length && errs[0]) {
			return (errs[0].title || "Apple Music error") +
				(errs[0].detail ? (": " + errs[0].detail) : "") +
				(errs[0].status ? (" (" + errs[0].status + ")") : "");
		}
		if (response && response.error) { return "" + response.error; }
		return "Apple Music request failed: " + url;
	},

	apiGet: function (path, params) {
		return this.request(path, params);
	},

	searchCatalog: function (term, limit, types) {
		limit = limit || 20;
		types = (types || ["songs", "albums", "artists", "playlists"]).join(",");
		return this.request("/catalog/" + this.storefront + "/search", {
			term: term,
			limit: limit,
			types: types
		});
	},

	// include:"tracks" pulls the album's full relationships.tracks.data in the SAME response.
	getAlbum: function (id) {
		return this.request("/catalog/" + this.storefront + "/albums/" + encodeURIComponent(id), { include: "tracks" });
	},

	getSong: function (id) {
		return this.request("/catalog/" + this.storefront + "/songs/" + encodeURIComponent(id));
	},

	getPlaylist: function (id) {
		return this.request("/catalog/" + this.storefront + "/playlists/" + encodeURIComponent(id));
	},

	// Real artist profile with the FULL discography (relationships.albums.data).
	getArtist: function (id) {
		return this.request("/catalog/" + this.storefront + "/artists/" + encodeURIComponent(id), { include: "albums" });
	},

	// Lean lookup to bridge a library SONG's catalogId -> its catalog artist id (for
	// backfilling artist artwork - library-artists never carry artwork, catalog do).
	getSongArtistRef: function (id) {
		return this.request("/catalog/" + this.storefront + "/songs/" + encodeURIComponent(id), { include: "artists" });
	},

	// ---- Personal library (requires musicUserToken) -----------------------

	searchLibrary: function (term, limit, types) {
		limit = limit || 25;
		types = (types || ["library-songs", "library-albums", "library-artists", "library-playlists"]).join(",");
		return this.request("/me/library/search", { term: term, limit: limit, types: types });
	},

	getLibrarySongs: function (limit, offset) {
		return this.request("/me/library/songs", { limit: limit || 100, offset: offset || 0 });
	},

	getLibraryAlbums: function (limit, offset) {
		return this.request("/me/library/albums", { limit: limit || 100, offset: offset || 0 });
	},

	getLibraryArtists: function (limit, offset) {
		return this.request("/me/library/artists", { limit: limit || 100, offset: offset || 0 });
	},

	getLibraryPlaylists: function (limit, offset) {
		return this.request("/me/library/playlists", { limit: limit || 100, offset: offset || 0 });
	},

	// Tracks are a separate, dedicated sub-resource per playlist, paginated the same way.
	getLibraryPlaylistTracks: function (playlistId, limit, offset) {
		return this.request("/me/library/playlists/" + encodeURIComponent(playlistId) + "/tracks", { limit: limit || 100, offset: offset || 0 });
	},

	artworkUrl: function (artwork, w, h) {
		if (!artwork || !artwork.url) {
			return "";
		}
		return artwork.url
			.replace("{w}", w || 320)
			.replace("{h}", h || 320);
	},

	mapSong: function (item) {
		if (!item) {
			return null;
		}

		var a = item.attributes || {};
		var art = a.artwork || {};
		var genres = a.genreNames || [];
		var previewUrl = (a.previews && a.previews.length && a.previews[0] && a.previews[0].url) || "";

		return {
			id: item.id || "",
			_id: item.id || "",
			type: item.type || "songs",
			title: a.name || "",
			name: a.name || "",
			artist: a.artistName || "",
			album: a.albumName || "",
			genre: genres.length ? genres[0] : "",
			genreNames: genres,
			artUrl: this.artworkUrl(art, 320, 320),
			artwork: art,
			duration: Math.round((a.durationInMillis || 0) / 1000),
			durationInMillis: a.durationInMillis || 0,
			previewUrl: previewUrl,
			playable: !!previewUrl,
			trackNumber: a.trackNumber || 0,
			discNumber: a.discNumber || 0,
			releaseDate: a.releaseDate || "",
			contentRating: a.contentRating || "",
			url: a.url || "",
			previews: a.previews || [],
			strTrackImage: this.artworkUrl(art, 320, 320),
			arThumbnails: this.artworkUrl(art, 320, 320) ? [{ data: this.artworkUrl(art, 320, 320) }] : []
		};
	},

	mapAlbum: function (item) {
		if (!item) {
			return null;
		}

		var a = item.attributes || {};
		var art = a.artwork || {};
		var genres = a.genreNames || [];

		return {
			id: item.id || "",
			type: item.type || "albums",
			title: a.name || "",
			name: a.name || "",
			artist: a.artistName || "",
			album: a.name || "",
			genre: genres.length ? genres[0] : "",
			genreNames: genres,
			artUrl: this.artworkUrl(art, 640, 640),
			artwork: art,
			trackCount: a.trackCount || 0,
			releaseDate: a.releaseDate || "",
			playable: true,
			url: a.url || ""
		};
	},

	mapPlaylist: function (item) {
		if (!item) {
			return null;
		}

		var a = item.attributes || {};
		var art = a.artwork || {};

		return {
			id: item.id || "",
			type: item.type || "playlists",
			title: a.name || "",
			name: a.name || "",
			curator: a.curatorName || "",
			description: (a.description && (a.description.standard || a.description.short)) || "",
			artUrl: this.artworkUrl(art, 640, 640),
			artwork: art,
			playable: true,
			url: a.url || ""
		};
	},

	mapArtist: function (item) {
		if (!item) {
			return null;
		}

		var a = item.attributes || {};
		var art = a.artwork || {};
		var albums = (item.relationships && item.relationships.albums && item.relationships.albums.data) || [];
		return {
			id: item.id || "",
			type: item.type || "artists",
			name: a.name || "",
			genreNames: a.genreNames || [],
			artUrl: this.artworkUrl(art, 320, 320),
			albumCount: albums.length || 0,
			url: a.url || ""
		};
	},

	mapSearchResults: function (response) {
		var results = (response || {}).results || {};
		var self = this;

		function mapItems(bucket, mapper) {
			var data = (bucket && bucket.data) || [];
			return data.map(function (item) {
				return mapper.call(self, item);
			});
		}

		return {
			songs: mapItems(results.songs, this.mapSong),
			albums: mapItems(results.albums, this.mapAlbum),
			artists: mapItems(results.artists, this.mapArtist),
			playlists: mapItems(results.playlists, this.mapPlaylist)
		};
	}
};
