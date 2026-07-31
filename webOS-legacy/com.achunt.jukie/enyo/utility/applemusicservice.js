/*globals enyo, window, fetch, Promise, WebToken */
enyo.kind({
    name: "AppleMusicService",
    kind: "enyo.Component",

    published: {
        developerToken: "",
        musicUserToken: "",   // personalized requests (library) need this
        storefront: "us",
        debug: false
    },

    events: {
        onReady: "",
        onError: ""
    },

    // Guards against ensureDeveloperToken() overlapping itself (a boot-time call and a
    // reactive 401 retry landing close together) - see ensureDeveloperToken/request.
    _refreshInFlight: null,

    API_BASE: "https://api.music.apple.com/v1",

    create: function () {
        this.inherited(arguments);
        this._listeners = {};
    },

    on: function (signal, fn) {
        if (!this._listeners[signal]) {
            this._listeners[signal] = [];
        }
        this._listeners[signal].push(fn);
    },

    // Both build ONE string and make a single console call, rather than
    // console.log.apply(console, [multiple, separate, args]) - confirmed on-device
    // (via utility/webtoken.js's identical original pattern) that webOS's
    // console->syslog bridge silently drops every argument past the first when called
    // that way. Matches the pattern kindSettings.log already uses (settings.js).
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

    ready: function () {
        if (!this.developerToken) {
            this.error("missing developerToken - catalog requests will fail");
            this.doError({ error: new Error("Missing Apple Music developer token") });
            return false;
        }
        this.doReady({});
        return true;
    },

    // Refreshes developerToken from music.apple.com if it's missing/near-expiry (see
    // utility/webtoken.js - a client-side port of jukie-drm's own auto-refresh). Never
    // rejects. Resolves the (possibly unchanged) current token. Concurrent calls share
    // one in-flight attempt instead of racing separate fetches.
    ensureDeveloperToken: function (force) {
        var self = this;
        if (this._refreshInFlight) {
            return this._refreshInFlight;
        }
        this._refreshInFlight = WebToken.ensure(this.developerToken, force).then(function (result) {
            self._refreshInFlight = null;
            if (result.changed) {
                self.log("developer token auto-refreshed from music.apple.com");
                self.setDeveloperToken(result.token);
                self.emitSignal("onDeveloperTokenRefreshed", { token: result.token, expiry: WebToken.jwtExpiry(result.token) });
            }
            return result.token;
        }).catch(function (err) {
            // WebToken.ensure() itself doesn't reject, but guard anyway so a refresh
            // attempt can never take down a caller that awaited it.
            self._refreshInFlight = null;
            self.error("ensureDeveloperToken failed unexpectedly", err);
            return self.developerToken;
        });
        return this._refreshInFlight;
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

    request: function (path, params, _isRetry) {
        var self = this;
        var query = this._buildQuery(params);
        var url = this.API_BASE + path + (query ? ("?" + query) : "");

        if (!this.developerToken) {
            return Promise.reject(new Error("AppleMusicService requires developerToken"));
        }

        this.log("GET", url);

        // api.music.apple.com rejects the public "AMPWebPlay" web-player developer
        // token with a 401 unless the request carries an Origin matching
        // music.apple.com - confirmed by direct testing: an otherwise-valid, freshly
        // scraped token gets 401 with only Authorization set, 200 once Origin is
        // added. A real browser sends this automatically for music.apple.com's own
        // page scripts; this app isn't that origin, so it has to set it explicitly.
        // (A real Apple Developer Program JWT - the other supported token type,
        // see the README - is not known to require this, but sending it either way
        // is harmless.)
        var headers = {
            "Authorization": "Bearer " + this.developerToken,
            "Origin": "https://music.apple.com",
            "Referer": "https://music.apple.com/"
        };
        if (this.musicUserToken) {
            headers["Music-User-Token"] = this.musicUserToken;
        }

        return fetch(url, {
            method: "GET",
            headers: headers
        }).then(function (response) {
            if (response.status === 401 && !_isRetry) {
                // The token's own exp claim can say "still fine" while Apple's server
                // disagrees (revoked, or this was never a working token to begin with -
                // see the 2026-07-27 investigation into "Your Library" coming back
                // empty). Force one real re-scrape via WebToken before giving up; if it
                // can't reach/parse music.apple.com (most likely a cross-origin block -
                // see webtoken.js), ensureDeveloperToken resolves the SAME token and
                // this just fails again below, no worse than before.
                return self.ensureDeveloperToken(true).then(function () {
                    return self.request(path, params, true);
                });
            }
            if (!response.ok) {
                throw new Error("Apple Music API request failed: " + response.status + " " + url);
            }
            return response.json();
        }).catch(function (err) {
            self.error("request failed", url, err);
            self.emitSignal("onAppleMusicError", { error: err });
            throw err;
        });
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

    // include:"tracks" pulls the album's full relationships.tracks.data in the SAME
    // response - a single-resource GET (unlike /search) already carries relationships.
    getAlbum: function (id) {
        return this.request("/catalog/" + this.storefront + "/albums/" + encodeURIComponent(id), {include: "tracks"});
    },

    getSong: function (id) {
        return this.request("/catalog/" + this.storefront + "/songs/" + encodeURIComponent(id));
    },

    getPlaylist: function (id) {
        return this.request("/catalog/" + this.storefront + "/playlists/" + encodeURIComponent(id));
    },

    // Real artist profile with the FULL discography (relationships.albums.data), used
    // for the artist detail page instead of a blind text search (which only ever
    // surfaced whatever a handful of songs happened to text-match the artist's name).
    getArtist: function (id) {
        return this.request("/catalog/" + this.storefront + "/artists/" + encodeURIComponent(id), {include: "albums"});
    },

    // Lean lookup used ONLY to bridge a library SONG's catalogId -> its catalog artist id
    // (for backfilling artist artwork - library-artists never carry artwork, catalog
    // artists do). Songs (unlike library ALBUMS - confirmed via a raw API response that
    // library-album playParams has no catalogId, only a library id) DO carry a real
    // catalog id, so we bridge through one of the artist's own songs instead.
    getSongArtistRef: function (id) {
        return this.request("/catalog/" + this.storefront + "/songs/" + encodeURIComponent(id), {include: "artists"});
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

    // The library-playlists LIST endpoint above only returns metadata (name, artwork,
    // description) - never the actual songs. Tracks are a separate, dedicated sub-resource
    // per playlist, paginated the same way as the other library list endpoints.
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
});
