/*globals enyo, $L, event, Utilities, window, PalmSystem, MediaIndex */
var LibraryTools = {
	
	_normalizeString: function (value)
	{
		if (value === undefined || value === null)
		{
			return "";
		}
		return enyo.g11n.Char.toUpper(String(value));
	},

	_getTrackNumber: function (item)
	{
		if (!item)
		{
			return 0;
		}
		if (item.trackNumber !== undefined && item.trackNumber !== null)
		{
			return Number(item.trackNumber) || 0;
		}
		if (item.track && item.track.position !== undefined && item.track.position !== null)
		{
			return Number(item.track.position) || 0;
		}
		return 0;
	},
	
	sortbyArtist: function (arSongList, boolAsc)
	{
		var self = this;
		var sortFunc = function (boolAsc)
		{
			return function (a, b)
			{
				var aArtist = self._normalizeString(a.artist);
				var bArtist = self._normalizeString(b.artist);
				var aAlbum = self._normalizeString(a.album);
				var bAlbum = self._normalizeString(b.album);
				var aTrack = self._getTrackNumber(a);
				var bTrack = self._getTrackNumber(b);
				
				if (aArtist === bArtist)
				{
					if (aAlbum === bAlbum)
					{
						if (aTrack === bTrack)
						{
							return 0;
						}
						return aTrack < bTrack ? -1 : 1;
					}
					else
					{
						return aAlbum < bAlbum ? -1 : 1;
					}
				}
				else
				{
					if (boolAsc)
					{
						return aArtist < bArtist ? -1 : 1;
					}
					else
					{
						return aArtist < bArtist ? 1 : -1;
					}
				}
			};
		};
		
		if (arSongList && typeof(arSongList.sort) === "function")
		{
			arSongList.sort(sortFunc(boolAsc));
		}
		return arSongList;
	},
	
	sortbySong: function (arSongList, boolAsc)
	{
		if (arSongList && typeof(arSongList.sort) === "function")
		{
			arSongList.sort(this.sortFuncSong);
			
			if (!boolAsc)
			{
				arSongList.reverse();
			}
		}
		return arSongList;
	},
	
	sortFuncSong: function (a, b)
	{
		var aTitle = enyo.g11n.Char.toUpper((a && a.title) ? a.title : "");
		var bTitle = enyo.g11n.Char.toUpper((b && b.title) ? b.title : "");
		
		if (aTitle === bTitle)
		{
			return 0;
		}
		return aTitle < bTitle ? -1 : 1;
	},
	
	sortbyPos: function (arSongList, boolAsc)
	{
		var self = this;
		var sortFunc = function (boolAsc)
		{
			return function (a, b)
			{
				var aTrack = self._getTrackNumber(a);
				var bTrack = self._getTrackNumber(b);
				
				if (aTrack === bTrack)
				{
					return 0;
				}
				else
				{
					if (boolAsc)
					{
						return aTrack < bTrack ? -1 : 1;
					}
					else
					{
						return aTrack < bTrack ? 1 : -1;
					}
				}
			};
		};
		if (arSongList && typeof(arSongList.sort) === "function")
		{
			arSongList.sort(sortFunc(boolAsc));
		}
		return arSongList;
	},
	
	sortbyAlbum: function (arSongList, boolAsc)
	{
		var self = this;
		var sortFunc = function (boolAsc)
		{
			return function (a, b)
			{
				var aAlbum = self._normalizeString(a.album);
				var bAlbum = self._normalizeString(b.album);
				var aTrack = self._getTrackNumber(a);
				var bTrack = self._getTrackNumber(b);
				
				if (aAlbum === bAlbum)
				{
					if (aTrack === bTrack)
					{
						return 0;
					}
					return aTrack < bTrack ? -1 : 1;
				}
				else
				{
					if (boolAsc)
					{
						return aAlbum < bAlbum ? -1 : 1;
					}
					else
					{
						return aAlbum < bAlbum ? 1 : -1;
					}
				}
			};
		};
		if (arSongList && typeof(arSongList.sort) === "function")
		{
			arSongList.sort(sortFunc(boolAsc));
		}
		return arSongList;
	},
	
	sortRandom: function(arSongList)
	{
		if (arSongList && typeof(arSongList.sort) === "function")
		{
			arSongList.sort(function () { return (Math.round(Math.random()) - 0.5); });
		}
	},
	
	sortOrigOrder: function (arSongList)
	{
		var sortFunc = function ()
		{
			return function (a, b)
			{
				if (a.origIndex === b.origIndex)
				{
					return 0;
				}
				return a.origIndex < b.origIndex ? -1 : 1;				
			};
		};
		if (arSongList && typeof(arSongList.sort) === "function")
		{
			arSongList.sort(sortFunc());
		}
		return arSongList;
	},
	
	sort: function(type, arSongList, boolAsc)
	{
		switch(type)
		{
			case "title":
				this.sortbySong(arSongList, boolAsc);
				break;
			case "pos":
				this.sortbyPos(arSongList, boolAsc);
				break;
			case "album":
				this.sortbyAlbum(arSongList, boolAsc);
				break;
			case "artist":
				this.sortbyArtist(arSongList, boolAsc);
				break;
		}
	}
};

Error.prototype._toString = Error.prototype.toString;
Error.prototype.toString = function() {
	return (this.stack || this._toString()) + "-----";
};