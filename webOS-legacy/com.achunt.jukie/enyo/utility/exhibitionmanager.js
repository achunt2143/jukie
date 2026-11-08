/*globals enyo */
enyo.kind(
{
	name: "kindExhibitionManager",
	kind: "Component",
	components: [

	],

	EXHIBITION_WINDOW_NAME: "com.achunt.jukie.exhibition",

	pushTrackInfo: function (objTrackInfo)
	{
		this.log();
		this._pushParams({ objTrackInfo: objTrackInfo });
	},

	pushPlayState: function (boolAudioPlaying)
	{
		this.log(boolAudioPlaying);
		this._pushParams({ boolAudioPlaying: boolAudioPlaying });
	},

	pushTrackTime: function (objTrackTimes)
	{
		this._pushParams({ objTrackTimes: objTrackTimes });
	},

	pushLyricsState: function (boolLyricsShowing)
	{
		this.log(boolLyricsShowing);
		this._pushParams({ boolLyricsShowing: boolLyricsShowing });
	},

	pushLyrics: function (objLyrics, strSongId)
	{
		this._pushParams({ objLyrics: objLyrics, strLyricsSongId: strSongId });
	},

	_pushParams: function (obj)
	{
		var winExhibition = enyo.windows.fetchWindow(this.EXHIBITION_WINDOW_NAME);
		if (winExhibition)
		{
			enyo.windows.setWindowParams(winExhibition, obj);
		}
	}
});
