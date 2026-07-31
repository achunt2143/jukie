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

	_pushParams: function (obj)
	{
		var winExhibition = enyo.windows.fetchWindow(this.EXHIBITION_WINDOW_NAME);
		if (winExhibition)
		{
			enyo.windows.setWindowParams(winExhibition, obj);
		}
	}
});
