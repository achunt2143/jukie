/*globals Utilities, enyo, $L, event, Utilities:true, window, PalmSystem, MediaIndex, escape */
Utilities = {
	
	time_formatter: null,
	_objArtworkUrlCache: {},

	formatTime: function(floatSeconds)
	{
		if (this.time_formatter === null)
		{
			this.time_formatter = new enyo.g11n.DurationFmt();
		}

		floatSeconds = Number(floatSeconds);
		if (!this.isNumeric(floatSeconds) || floatSeconds < 0)
		{
			floatSeconds = 0;
		}

		var intMinutes = Math.floor(floatSeconds / 60);
		var intSeconds = Math.floor(floatSeconds % 60);
		var intHours = Math.floor(intMinutes / 60);
		intMinutes = Math.floor(intMinutes % 60);
							
		return this.time_formatter.format({hours: intHours, minutes: intMinutes, seconds: intSeconds});
	},
	
	isNumeric: function(objValue)
	{
		return typeof objValue === "number" && isFinite(objValue);
	},
	
	S4: function()
	{
	    return (((1 + Math.random()) * 100000000) | 0).toString(16).substring(1);
	},

	generateGuid: function()
	{
        return (this.S4() + this.S4() + "-" + this.S4() + "-" + this.S4() + "-" + this.S4() + "-" + this.S4() + this.S4() + this.S4()).toUpperCase();
	},

	fastTrim: function (strRaw)
	{
		if (typeof strRaw === "string")
		{
			return strRaw.replace(/^\s\s*/, "").replace(/\s\s*$/, "");
		}
		
		return strRaw;
	},

	artworkUrl: function (artwork, intThumbSize, intThumbHeight)
	{
		var strUrl;
		var intWidth = intThumbSize || 38;
		var intHeight = intThumbHeight || intWidth;
		var strCacheKey;

		if (!artwork)
		{
			return "";
		}

		if (typeof artwork === "string")
		{
			strUrl = artwork;
		}
		else if (artwork.artUrl)
		{
			strUrl = artwork.artUrl;
		}
		else if (artwork.data)
		{
			strUrl = artwork.data;
		}
		else if (artwork.url)
		{
			strUrl = artwork.url;
		}
		else
		{
			return "";
		}

		if (typeof strUrl !== "string" || strUrl.length === 0)
		{
			return "";
		}

		strCacheKey = strUrl + "::" + intWidth + "x" + intHeight;
		if (this._objArtworkUrlCache[strCacheKey])
		{
			return this._objArtworkUrlCache[strCacheKey];
		}

		if (strUrl.indexOf("{w}") !== -1 || strUrl.indexOf("{h}") !== -1)
		{
			strUrl = strUrl.replace("{w}", intWidth).replace("{h}", intHeight);
		}

		this._objArtworkUrlCache[strCacheKey] = strUrl;
		return strUrl;
	},

	getTrackImage: function (objImage, intThumbSize)
	{
		return this.artworkUrl(objImage, intThumbSize || 320);
	},
	
	getItemThumb: function (arThumbs, intThumbSize)
	{
		var intThumbsTotalCount = 0;
		var strThumbURL = "";
		var intThumbIndex;
		var item;

		if (intThumbSize === undefined)
		{
			intThumbSize = 38;
		}

		if (typeof arThumbs === "string")
		{
			strThumbURL = this.artworkUrl(arThumbs, intThumbSize);
			intThumbsTotalCount = strThumbURL ? 1 : 0;
		}
		else if (arThumbs && arThumbs.url)
		{
			strThumbURL = this.artworkUrl(arThumbs, intThumbSize);
			intThumbsTotalCount = strThumbURL ? 1 : 0;
		}
		else if (arThumbs && arThumbs.artUrl)
		{
			strThumbURL = this.artworkUrl(arThumbs.artUrl, intThumbSize);
			intThumbsTotalCount = strThumbURL ? 1 : 0;
		}
		else if (arThumbs)
		{
			for (intThumbIndex = 0; intThumbIndex < arThumbs.length; intThumbIndex++)
			{
				if (arThumbs[intThumbIndex])
				{
					intThumbsTotalCount++;
				}
			}

			for (intThumbIndex = 0; intThumbIndex < arThumbs.length; intThumbIndex++)
			{
				item = arThumbs[intThumbIndex];
				if (item !== null && item !== undefined)
				{
					strThumbURL = this.artworkUrl(item, intThumbSize);
					if (strThumbURL)
					{
						break;
					}
				}
			}
		}

		return {strThumbURL: strThumbURL, intThumbsTotalCount: intThumbsTotalCount, intThumbSize: intThumbSize};
	},
	
	getBaseLabelChar: function (strRaw)
	{
		var charFirst = strRaw.charAt(0);
		if (enyo.g11n.Char.isLetter(charFirst))
		{
			return enyo.g11n.Char.toUpper(enyo.g11n.Char.getBaseString(charFirst));
		}
		
		return "#";
	},
	
	getPlaylistSongData: function(objSong)
	{
		if (typeof objSong !== "object")
		{
			return {};
		}
		var retObjSong = {};
		retObjSong.title = objSong.title;
		retObjSong.artist = objSong.artist;
		retObjSong.album = objSong.album || "";
		retObjSong.id = objSong.id || objSong.path || "";
		retObjSong.path = objSong.path || "";
		retObjSong.artUrl = this.artworkUrl(objSong.artUrl || objSong.artwork || "", 320);
		retObjSong.duration = objSong.duration || 0;
		retObjSong.playable = (objSong.playable !== false);
		return retObjSong;		
	},
	
	capitalize: function(string)
	{
		if (typeof string !== "string" || string.length === 0)
		{
			return string;
		}
	    return string.charAt(0).toUpperCase() + string.slice(1);
	}
	
};