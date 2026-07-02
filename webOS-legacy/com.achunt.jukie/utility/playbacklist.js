/*globals enyo, $L, event, Utilities, window, PalmSystem, MediaIndex, LibraryTools */
enyo.kind(
{
	name: "kindPlaybackList",
	kind: "Component",
	events: {onShuffleChanged: "", onRepeatChanged: "", onStrOriginListIDChanged: ""},
	
	published: {
		intCurrTrackIndex: 0,
		intRepeatMode: 0,
		strOriginListID: ""
		// 0:off, 1:all, 2:one
	},
	
	_arPlaybackList: [],
	_boolShuffleOn: false,
	_strListQuery: "{}",
	_arRepeatMode: ["off", "all", "one"],

	setPlaybackList: function (objSetPlaybackList)
	{
		this.log(objSetPlaybackList && objSetPlaybackList.intStartTrackIndex);

		if (objSetPlaybackList && objSetPlaybackList.arSetPlaybackList !== undefined)
		{
			if (objSetPlaybackList.arSetPlaybackList.length)
			{
				this._checkStartTrackIndex(objSetPlaybackList);
				this.intCurrTrackIndex = objSetPlaybackList.intStartTrackIndex;

				if (objSetPlaybackList.strOriginListID !== this.strOriginListID || objSetPlaybackList.strListQuery !== this._strListQuery)
				{
					this.strOriginListID = objSetPlaybackList.strOriginListID;
					this._strListQuery = objSetPlaybackList.strListQuery;
					this.doStrOriginListIDChanged();

					this._arPlaybackList = objSetPlaybackList.arSetPlaybackList.slice(0);

					for (var intTrackIndex = 0; intTrackIndex < this._arPlaybackList.length; intTrackIndex++)
					{
						this._normalizeTrack(this._arPlaybackList[intTrackIndex], intTrackIndex);
					}

					if (this._boolShuffleOn)
					{
						this.shufflePlaylist(true);
					}

					this.log(this._arPlaybackList);
				}
				else
				{
					this.switchTrack(objSetPlaybackList.intStartTrackIndex);
				}

				return true;
			}
		}

		return false;
	},

	_normalizeTrack: function (objTrack, intTrackIndex)
	{
		if (!objTrack)
		{
			return;
		}

		objTrack.origIndex = intTrackIndex;

		if (objTrack.id === undefined || objTrack.id === null || objTrack.id === "")
		{
			if (objTrack._id !== undefined && objTrack._id !== null)
			{
				objTrack.id = objTrack._id;
			}
			else if (objTrack.path !== undefined && objTrack.path !== null)
			{
				objTrack.id = objTrack.path;
			}
		}

		objTrack._id = objTrack.id || objTrack._id || "";

		if (objTrack.trackNumber === undefined || objTrack.trackNumber === null)
		{
			if (objTrack.track && objTrack.track.position !== undefined)
			{
				objTrack.trackNumber = objTrack.track.position;
			}
			else
			{
				objTrack.trackNumber = 0;
			}
		}

		if (!objTrack.artUrl)
		{
			if (objTrack.thumbnails && objTrack.thumbnails.length > 0 && objTrack.thumbnails[0])
			{
				objTrack.artUrl = objTrack.thumbnails[0].data || "";
			}
			else
			{
				objTrack.artUrl = "";
			}
		}

		objTrack.strTrackImage = objTrack.artUrl || "";
		objTrack.playable = (objTrack.playable !== false);
	},

	_checkStartTrackIndex: function(objSetPlaybackList)
	{
		if (objSetPlaybackList.intStartTrackIndex === undefined)
		{
			if (this.getShuffleState())
			{
				objSetPlaybackList.intStartTrackIndex = Math.floor(Math.random() * objSetPlaybackList.arSetPlaybackList.length);
			}
			else
			{
				objSetPlaybackList.intStartTrackIndex = 0;
			}
		}
	},
	
	setOrigIndexes: function ()
	{
	},

	updatePlaybackList: function()
	{
	},
		
	nextTrack: function (boolForce)
	{
		this.log(this._arRepeatMode[this.intRepeatMode]);
		if (this._arRepeatMode[this.intRepeatMode] !== "one" || boolForce)
		{
			this.intCurrTrackIndex += 1;
			
			if (this.intCurrTrackIndex >= this.getPlaybacklistLength())
			{
				if (this._arRepeatMode[this.intRepeatMode] === "all" || boolForce)
				{
					this.intCurrTrackIndex = 0;
				}
				else
				{
					return false;
				}
			}			
		}
		
		return true;			
	},
	
	prevTrack: function (floatTrackTime, boolForce)
	{
		this.log("prevTrack");
		
		if (floatTrackTime < 15)
		{
			if (this._arRepeatMode[this.intRepeatMode] !== "one" || boolForce)
			{
				this.intCurrTrackIndex -= 1;
				
				if (this.intCurrTrackIndex < 0)
				{
					if (this._arRepeatMode[this.intRepeatMode] === "all" || boolForce)
					{
						this.intCurrTrackIndex = this.getPlaybacklistLength() - 1;					
					}
					else
					{
						return false;
					}
				}			
			}
		}
		
		return true;
	},
	
	switchTrack: function (intSetTrackIndex)
	{
		if (intSetTrackIndex === undefined)
		{
			intSetTrackIndex = 0;
		}
		var length = this.getPlaybacklistLength() - 1;
		if (intSetTrackIndex < 0 || intSetTrackIndex > length)
		{
			this.intCurrTrackIndex = 0;
		}
		else
		{
			if (this._boolShuffleOn)
			{
				this.intCurrTrackIndex = this.getCurrentSongIndex(intSetTrackIndex);
			}
			else
			{
				this.intCurrTrackIndex = intSetTrackIndex;
			}
		}
	},
	
	setRepeatMode: function (intForceMode)
	{
		if (intForceMode !== undefined)
		{
			this.intRepeatMode = intForceMode;
		}
		else
		{
			this.intRepeatMode++;
		}
		
		if (this.intRepeatMode < 0 || this.intRepeatMode >= this._arRepeatMode.length)
		{
			this.intRepeatMode = 0;
		}
		this.log(this.intRepeatMode);

		this.doRepeatChanged(this._arRepeatMode[this.intRepeatMode], this.intRepeatMode);
	},
	
	shufflePlaylist: function (boolForceShuffle)
	{
		this.log();
		this.log("_boolShuffleOn: ", this._boolShuffleOn);
		this.log("boolForceShuffle: ", boolForceShuffle);

		if (boolForceShuffle !== undefined)
		{
			this._boolShuffleOn = boolForceShuffle;	
		}
		else
		{
			this._boolShuffleOn = !this._boolShuffleOn;
		}

		this.log("_boolShuffleOn: ", this._boolShuffleOn);
		
		if (this.getPlaybacklistLength() > 0)
		{			
			if (this._boolShuffleOn)
			{
				LibraryTools.sortRandom(this._arPlaybackList);
				
				var currentIndex = this.getCurrentSongIndex(this.intCurrTrackIndex);
				if (currentIndex < 0)
				{
					currentIndex = 0;
				}
				var objTempCurrSong = this._arPlaybackList.splice(currentIndex, 1);
				this.log("objTempCurrSong: ", objTempCurrSong);
				if (objTempCurrSong.length)
				{
					this._arPlaybackList.splice(0, 0, objTempCurrSong[0]);
				}
				this.intCurrTrackIndex = 0;
				
				this.log(this._arPlaybackList);
				this.log(this._arPlaybackList[0]);
			}
			else
			{
				if (this.getCurrentPlayBackItem())
				{
					this.intCurrTrackIndex = this.getCurrentPlayBackItem().origIndex;
				}
				LibraryTools.sortOrigOrder(this._arPlaybackList);
			}
		}

		this.doShuffleChanged(this._boolShuffleOn, this.intCurrTrackIndex);
		
		this.log("this._arPlaybackList: ", this._arPlaybackList);
		this.log("this.intCurrTrackIndex: ", this.intCurrTrackIndex);
	},
	
	songListChanged: function (intCurrTrackOrigIndex)
	{
		this.log();

		if (this._boolShuffleOn)
		{
			this.shufflePlaylist(true);
		}
		this.intCurrTrackIndex = this.getCurrentSongIndex(intCurrTrackOrigIndex);
	},
	
	sortSongList: function (strSortMode, boolSortAsc)
	{
	},
	
	getCurrentSongIndex: function (intOrigIndex)
	{
		this.log("getCurrentSongIndex: ", intOrigIndex);
		for (var intCheckIndex = 0; intCheckIndex < this._arPlaybackList.length; intCheckIndex++)
		{
			this.log(this._arPlaybackList[intCheckIndex].origIndex, ":", this._arPlaybackList[intCheckIndex].title);
			if (this._arPlaybackList[intCheckIndex].origIndex === intOrigIndex)
			{
				this.log("found");
				return intCheckIndex;
			}
		}
		return -1;
	},
	
	getCurrSongOrigIndex: function()
	{
		if (this.getCurrentPlayBackItem())
		{
			return this.getCurrentPlayBackItem().origIndex;		
		}
		else
		{
			return -9999;
		}
	},
	
	getCurrSongID: function ()
	{
		if (this.getCurrentPlayBackItem())
		{
			return this.getCurrentPlayBackItem().id || "";
		}
		else
		{
			return "";
		}		
	},

	getPlaybackList: function ()
	{
		return this._arPlaybackList;
	},
	
	getCurrentPlayBackItem: function ()
	{
		return this._arPlaybackList[this.intCurrTrackIndex];
	},
	
	getPlaybacklistLength: function ()
	{
		return this._arPlaybackList.length;
	},
	
	getCurrentPlayBackImage: function()
	{
		var item = this._arPlaybackList[this.intCurrTrackIndex];
		return (item && item.artUrl) ? item.artUrl : "";
	},
	
	getShuffleState: function (boolFormatted)
	{
		if (boolFormatted)
		{
			var strShuffle = (this._boolShuffleOn) ? "ON" : "OFF";
			return strShuffle;
		}
		return this._boolShuffleOn;
	},
	
	getRepeatMode: function (boolFormatted)
	{
		if (boolFormatted)
		{
			return this._arRepeatMode[this.intRepeatMode];
		}
		else
		{
			return this.intRepeatMode;
		}
	},
	
	getListQuery: function()
	{
		return this._strListQuery;
	}
});