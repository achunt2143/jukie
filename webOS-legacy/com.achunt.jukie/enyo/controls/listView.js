/*globals enyo, $L, event, Utilities, window, LibraryTools */
enyo.kind({
	name: "listView",
	kind: "VFlexBox",
	events: {},
			
	create: function () {
		this.inherited(arguments);
	},

	// Show a spinner (in the empty-placeholder spot) while a media request is in flight.
	// Hidden again by the results handler (gotAlbums/gotSongs/...) which restores content
	// or the empty placeholder.
	setLoading: function (bool) {
		if (!this.$.loading) { return; }
		this.$.loading.setShowing(bool);
		if (bool) {
			if (this.$.empty) { this.$.empty.hide(); }
			if (this.$.content) { this.$.content.hide(); }
		}
	},

	highlightTrack: function (objTrackInfo)
	{
		this.log();	
		try
		{
			if(objTrackInfo)
			{
			this.log(objTrackInfo.intTrackIndex);
				this.intCurrTrack = objTrackInfo.intTrackIndex;
				this.intCurrTrackOrigIndex = objTrackInfo.intTrackOrigIndex;
				this.strCurrTrackID = objTrackInfo.strTrackID;
				this.strCurrTrackListQuery = objTrackInfo.strListQuery;
				
				this.log(this.intCurrTrack);
				
			}
			
			if(this.boolViewActive)
			{
				this.$.listMedia.refresh();
			}
		}
		catch(err)
		{
			this.log("error:" + err);
		}
		
	}
});