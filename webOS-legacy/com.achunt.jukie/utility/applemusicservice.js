/*globals enyo, window, fetch, Promise */
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

    log: function () {
        if (this.debug && typeof console !== "undefined" && console.log) {
            console.log.apply(console, ["[AppleMusicService]"].concat([].slice.call(arguments)));
        }
    },

    error: function () {
        if (typeof console !== "undefined" && console.error) {
            console.error.apply(console, ["[AppleMusicService]"].concat([].slice.call(arguments)));
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

    request: function (path, params) {
        var self = this;
        var query = this._buildQuery(params);
        var url = this.API_BASE + path + (query ? ("?" + query) : "");

        if (!this.developerToken) {
            return Promise.reject(new Error("AppleMusicService requires developerToken"));
        }

        this.log("GET", url);

        var headers = { "Authorization": "Bearer " + this.developerToken };
        if (this.musicUserToken) {
            headers["Music-User-Token"] = this.musicUserToken;
        }

        return fetch(url, {
            method: "GET",
            headers: headers
        }).then(function (response) {
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
