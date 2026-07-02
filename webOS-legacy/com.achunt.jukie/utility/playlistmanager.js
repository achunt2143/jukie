/*globals enyo, $L, event, Utilities, window, PalmSystem, MediaIndex */
enyo.kind(
{
	name: "kindPlaylistManager",
	kind: "Component",
	events: {onSetPlaybackList: "", onRequestMedia: "", onRefreshPlaylists: "", onPlaylistDeleted: ""},
	components: [
		{kind: "DbService", dbKind: "com.palm.music.staticplaylists:1", onFailure: "onFailure_dbsStaticPlaylists", components: [
			{ name: "dbsGetStaticPlaylists", method: "find", onSuccess: "gotPlaylists"},
			{ name: "dbsPutStaticPlaylists", method: "put", onSuccess: "onSuccess_PutStaticPlaylists"},
			{ name: "dbsMergeStaticPlaylists", method: "merge", onSuccess: "onSuccess_MergeStaticPlaylists", onFailure: "onFailure_MergeStaticPlaylists"},
			{ name: "dbsDelStaticPlaylists", method: "del", onSuccess: "onSuccess_DeleStaticPlaylists"}
		]}
	],
	
	arAddQueue: [],
	boolMerging: false,
		
	create: function ()
	{
		this.inherited(arguments);
	},
	
	requestPlaylists: function (objGetPlaylistsRequest)
	{
		this.log();
		this.getPlaylists(objGetPlaylistsRequest);
	},
   
	getPlaylists: function (objGetPlaylistsRequest)
	{
		this.log("****");

		try
		{
			var q = {
				orderBy: objGetPlaylistsRequest.order || "",
				where: objGetPlaylistsRequest.where || []
			};
			
			if (objGetPlaylistsRequest.queryType === undefined)
			{
				objGetPlaylistsRequest.queryType = "find";
			}
			
			this.$.dbsGetStaticPlaylists.method = objGetPlaylistsRequest.queryType;
			this.$.dbsGetStaticPlaylists.setDbKind("com.palm.music.staticplaylists:1");
				
			var req = this.$.dbsGetStaticPlaylists.call({watch: false, query: q, subscribe: false}, {});
			req.objGetPlaylistsRequest = objGetPlaylistsRequest;
	
			this.log("**** called StaticPlaylists query");
		}
		catch(err)
		{
			this.log(err);
		}
	},
	
	gotPlaylists: function (inSender, inResponse, inRequest)
	{
		this.log("****");
				
		if (inResponse.results)
		{
			this.log(inResponse.results.length);
			this._normalizePlaylists(inResponse.results);

			if (inRequest.objGetPlaylistsRequest)
			{
				if (inRequest.objGetPlaylistsRequest.callback)
				{
					inRequest.objGetPlaylistsRequest.callback(inResponse, inRequest);
				}
			}
		}
	},

	_normalizePlaylists: function (results)
	{
		var i;
		if (!results)
		{
			return;
		}
		for (i = 0; i < results.length; i++)
		{
			this._normalizePlaylist(results[i]);
		}
	},

	_normalizePlaylist: function (playlist)
	{
		var i;
		if (!playlist)
		{
			return;
		}
		if (!playlist.tracks)
		{
			playlist.tracks = [];
		}
		for (i = 0; i < playlist.tracks.length; i++)
		{
			playlist.tracks[i] = this._normalizePlaylistTrack(playlist.tracks[i]);
		}
	},

	_normalizePlaylistTrack: function (track)
	{
		if (typeof track !== "object" || track === null)
		{
			return {};
		}
		return {
			title: track.title || "",
			artist: track.artist || "",
			album: track.album || "",
			id: track.id || track.path || track._id || "",
			path: track.path || "",
			artUrl: track.artUrl || "",
			trackNumber: track.trackNumber || 0,
			playable: (track.playable !== false)
		};
	},
		
	insertStaticPlaylist: function (objPutPlaylistsRequest)
	{
		this.log(objPutPlaylistsRequest.strPlaylistName);
		this.putStaticPlaylistsCallback = objPutPlaylistsRequest.callback;
		this.$.dbsPutStaticPlaylists.call({objects: [{"_kind": "com.palm.music.staticplaylists:1", "name": objPutPlaylistsRequest.strPlaylistName, "tracks": []}]});
	},
	
	onSuccess_PutStaticPlaylists: function (sender, response)
	{
		this.log(response);
		if (response.results.length > 0 && this.putStaticPlaylistsCallback)
		{
			this.putStaticPlaylistsCallback(response.results[0].id);
		}
		delete this.putStaticPlaylistsCallback;
	},

	onFailure_dbsStaticPlaylists: function (inSender, inResponse)
	{
		this.log("****");
		this.log(inSender);
		this.log(inResponse);
	},

	addToPlaylist: function (objAddToPlaylist)
	{
		this.log();
		this.arAddQueue.push(objAddToPlaylist);
		this.processAddQueue();
	},
	
	processAddQueue: function ()
	{
		this.log(this.arAddQueue.length);
		
		if (this.arAddQueue.length > 0 && !this.boolMerging)
		{
			var objAddToPlaylist = this.arAddQueue.shift();
			var objGetMediaRequest;
			switch (objAddToPlaylist.strMediaType)
			{
				case "song":
					this.addLooseSongs(objAddToPlaylist);
					return true;
				case "artist":
					objGetMediaRequest = {where: [{"prop": "artist", "op": "=", "val": objAddToPlaylist.strMediaFilter}], mediaType: "song", order: "artist", callback: enyo.bind(this, "gotAddTracks"), plid: objAddToPlaylist.strPlaylistID};
					break;
				case "album":
					objGetMediaRequest = {where: [{"prop": "album", "op": "=", "val": objAddToPlaylist.strMediaFilter}, {"prop": "artist", "op": "=", "val": objAddToPlaylist.strMediaFilterSub}], mediaType: "song", order: "trackNumber", callback: enyo.bind(this, "gotAddTracks"), plid: objAddToPlaylist.strPlaylistID};
					break;
				case "genre":
					objGetMediaRequest = {where: [{"prop": "genre", "op": "=", "val": objAddToPlaylist.strMediaFilter}], mediaType: "song", order: "title", callback: enyo.bind(this, "gotAddTracks"), plid: objAddToPlaylist.strPlaylistID};
					break;
			}
	
			this.log("**** raising doRequestMedia");
			this.log("**** objGetMediaRequest: ", objGetMediaRequest);
			this.doRequestMedia(objGetMediaRequest);
		}
	},
	
	addLooseSongs: function (objAddToPlaylist)
	{
		var tempFunc = enyo.bind(this, function(inResponse, inRequest)
		{
			this.gotAddPlaylist(inResponse, inRequest);
			if (typeof(objAddToPlaylist.callback) === "function")
			{
				objAddToPlaylist.callback();
			}
		});
		var objGetPlaylistsRequest = {where: [{"prop": "_id", "op": "=", "val": objAddToPlaylist.strPlaylistID}], playlistType: "static", callback: tempFunc, arAddTracks: objAddToPlaylist.arTracks};

		this.log("**** raising doRequestMedia");
		this.log("**** objGetMediaRequest: ", objGetPlaylistsRequest);
		this.getPlaylists(objGetPlaylistsRequest);		
	},
	
	gotAddTracks: function (inResponse, inRequest)
	{
		this.log();
		if (inResponse && inResponse.results && inResponse.results.length > 0)
		{
			var arAddTracks = [];
			var intIndex;
			
			for (intIndex = 0; intIndex < inResponse.results.length; intIndex++)
			{
				this.log(inResponse.results[intIndex].title);
				arAddTracks[intIndex] = Utilities.getPlaylistSongData(inResponse.results[intIndex]);
			}

			if (inRequest && inRequest.objGetMediaRequest && inRequest.objGetMediaRequest.plid)
			{
				this.log(arAddTracks);
				var objGetPlaylistsRequest = {where: [{"prop": "_id", "op": "=", "val": inRequest.objGetMediaRequest.plid}], playlistType: "static", callback: enyo.bind(this, "gotAddPlaylist"), arAddTracks: arAddTracks};
				this.log("**** raising doRequestMedia");
				this.log("**** objGetMediaRequest: ", objGetPlaylistsRequest);
				this.getPlaylists(objGetPlaylistsRequest);
			}
		}
	},
	
	gotAddPlaylist: function (inResponse, inRequest)
	{
		this.log(inResponse);
		
		if (inRequest && inRequest.objGetPlaylistsRequest && inRequest.objGetPlaylistsRequest.arAddTracks)
		{
			var arAddTracks = inRequest.objGetPlaylistsRequest.arAddTracks;
			var normalizedTracks = [];
			var intTrackIndex;
			
			this.log("arAddTracks.length: ", arAddTracks.length);
			
			for (intTrackIndex = 0; intTrackIndex < arAddTracks.length; intTrackIndex++)
			{
				normalizedTracks.push(this._normalizePlaylistTrack(arAddTracks[intTrackIndex]));
			}
			
			if (inResponse.results)
			{
				var arAddPlaylists = inResponse.results.slice(0);
				this.log("this.arPlaylists.length: ", arAddPlaylists.length);
				
				if (arAddPlaylists.length > 0 && arAddPlaylists[0])
				{
					if (!arAddPlaylists[0].tracks)
					{
						arAddPlaylists[0].tracks = [];
					}
					
					this.log("arAddPlaylists[0].tracks: ", arAddPlaylists[0].tracks);
					arAddPlaylists[0].tracks = arAddPlaylists[0].tracks.concat(normalizedTracks);
					this.log("arAddPlaylists[0].tracks.length: ", arAddPlaylists[0].tracks.length);
					this.$.dbsMergeStaticPlaylists.call({objects: [arAddPlaylists[0]]});
					this.boolMerging = true;
				}
			}
		}
	},
	
	updateStaticPlaylist: function (objUpdatePlaylist)
	{
		try
		{
			if (objUpdatePlaylist && objUpdatePlaylist.objPlaylist)
			{
				this._normalizePlaylist(objUpdatePlaylist.objPlaylist);
			}
			var req = this.$.dbsMergeStaticPlaylists.call({objects: [objUpdatePlaylist.objPlaylist]});
			req.objUpdatePlaylist = objUpdatePlaylist;
		}
		catch (err)
		{
			this.log(err);
		}
	},
	
	onSuccess_MergeStaticPlaylists: function (inSender, inResponse, inRequest)
	{
		this.log();
		this.boolMerging = false;
		if (inRequest.objUpdatePlaylist)
		{
			this.doRefreshPlaylists();
			if (inRequest.objUpdatePlaylist.callback)
			{
				enyo.windows.addBannerMessage($L("Playlist updated"), "{}", "images/notification-small.png");
				inRequest.objUpdatePlaylist.callback();
			}
		}
		else
		{
			if (this.arAddQueue.length > 0)
			{
				this.processAddQueue();
			}
			else
			{
				enyo.windows.addBannerMessage($L("Added tracks to playlist"), "{}", "images/notification-small.png");
			}
		}
	},
	
	onFailure_MergeStaticPlaylists: function (inSender, inResponse, inRequest)
	{
		this.log();
		this.log(inResponse);
		this.boolMerging = false;
		
		if (inRequest.objUpdatePlaylist)
		{
			if (inRequest.objUpdatePlaylist.callback)
			{
				enyo.windows.addBannerMessage($L("Error updating playlist"), "{}", "images/notification-small.png");
				inRequest.objUpdatePlaylist.callback();
			}	
		}
		else
		{
			if (this.arAddQueue.length > 0)
			{
				this.processAddQueue();
			}
			else
			{
				enyo.windows.addBannerMessage($L("Error adding tracks to playlist"), "{}", "images/notification-small.png");			
			}
		}
	},
	
	deletePlaylist: function (objDeletePlaylist)
	{
		if (objDeletePlaylist.strPlaylistID !== undefined)
		{
			var req = this.$.dbsDelStaticPlaylists.call({ids: [objDeletePlaylist.strPlaylistID]});
			req.objDeletePlaylist = objDeletePlaylist;
		}
	},
	
	onSuccess_DeleStaticPlaylists: function (inSender, inResponse, inRequest)
	{
		this.log();
		this.doRefreshPlaylists();
		this.doPlaylistDeleted();
		if (inRequest.objDeletePlaylist.callback)
		{
			inRequest.objDeletePlaylist.callback();
		}
	}
});