/*globals enyo, setTimeout, $L, event, Utilities, window, PalmSystem, MediaIndex */
enyo.kind(
{
	name: "kindPlayback",
	kind: "Component",
	components: [
		{name: "PlaybackList", kind: "kindPlaybackList", onShuffleChanged: "doPlaybackShuffleChanged", onRepeatChanged: "doPlaybackRepeatChanged", onStrOriginListIDChanged: "doPlaybackListIDChanged"},
		{name: "AudioPlayer", kind: "kindAudioPlayer", onTimeUpdate: "onTimeChanged", onPlaying: "onAudioPlaying", onPaused: "onAudioPaused", onEnded: "onEnded", onError: "onAudioError", onBuffering: "onAudioBuffering"}
	],
	events: {onTrackPlaying: "", onSongEnd: "", onTrackEnded: "", onTrackSrcChanged: "", onUpdateTrackInfo: "", onUpdateTrackTime: "", onPlaybackShuffleChanged: "", onPlaybackRepeatChanged: "", onTrackPausePlay: "", onPlaybackListSet: "", onPlaybackListIDChanged: "", onTrackBuffering: ""},
	published: {boolPlaybackListSet: false, boolSuspendUpdates: false, boolSuspendPlayback: false, intUpdateRate: 333},

	intErrorCount: 0,
	INT_ERROR_MAX: 10,

	create: function ()
	{
		this.inherited(arguments);
	},

	destroy: function ()
	{
		this.stopTrackTimeUpdate();
	},

	boolSuspendUpdatesChanged: function ()
	{
		if (this.boolSuspendUpdates)
		{
			this.stopTrackTimeUpdate();
		}
		else
		{
			if (this.$.AudioPlayer.isPlaying())
			{
				this.onAudioSrcChanged(null, true);
			}
			else
			{
				this.updateTrackTime();
			}
		}
	},

	boolSuspendPlaybackChanged: function ()
	{
		this.log(this.boolSuspendPlayback);
	},

	setPlaybackList: function (objSetPlaybackList)
	{
		this.log();

		if (typeof(objSetPlaybackList.arSetPlaybackList) === "object")
		{
			this.boolPlaybackListSet = this.$.PlaybackList.setPlaybackList(objSetPlaybackList);

			if (this.boolPlaybackListSet)
			{
				if (objSetPlaybackList.intStartTrackTime === undefined)
				{
					objSetPlaybackList.intStartTrackTime = 0;
				}

				this.startPlayback(objSetPlaybackList.intStartTrackTime);

				this.log("Raising onPlaybackListSet");
				this.doPlaybackListSet(this.boolPlaybackListSet, objSetPlaybackList.arSetPlaybackList.length, this.$.PlaybackList.getShuffleState(true), this.$.PlaybackList.getRepeatMode(true));

				return true;
			}
		}

		return false;
	},

	startPlayback: function (intStartTrackTime)
	{
		this.log();
		this.playTrack(intStartTrackTime);
	},

	// Fully stop playback (used when the app is closed/swiped away, so the separate
	// service process doesn't keep playing in the background).
	stopPlayback: function ()
	{
		this.log();
		this.$.AudioPlayer.stop();
	},

	clearCache: function (callback)
	{
		this.log();
		this.$.AudioPlayer.clearCache(callback);
	},

	pausePlayback: function (boolForcePause)
	{
		if (this.boolSuspendPlayback)
		{
			return;
		}

		if (this.intErrorCount === this.INT_ERROR_MAX && boolForcePause === false)
		{
			this.playCurrent(0);
			return;
		}

		if (boolForcePause === false)
		{
			this.$.AudioPlayer.play();
		}
		else if (boolForcePause === true)
		{
			this.$.AudioPlayer.pause();
		}
		else
		{
			if (this.$.AudioPlayer.isPlaying())
			{
				this.$.AudioPlayer.pause();
			}
			else
			{
				this.$.AudioPlayer.play();
			}
		}
	},

	playCurrent: function (startTime)
	{
		var item = this.$.PlaybackList.getCurrentPlayBackItem();
		if (!item || (!item.previewUrl && !item.id))
		{
			return;
		}
		this.$.AudioPlayer.load(item.previewUrl, item.id, item.libraryId);
		if (startTime)
		{
			this.$.AudioPlayer.seekTo(startTime);
		}
		this.$.AudioPlayer.play();
	},

	playTrack: function (intStartTrackTime, boolForced, forcePlay)
	{
		var item = this.$.PlaybackList.getCurrentPlayBackItem();

		this.log(this.$.PlaybackList.intCurrTrackIndex);

		if (!item)
		{
			return;
		}
		if (forcePlay === undefined)
		{
			forcePlay = true;
		}
		if (intStartTrackTime === undefined)
		{
			intStartTrackTime = 0;
		}

		if (!item.id && (!item.playable || !item.previewUrl))
		{
			this.log("Item not playable (no id or preview), skipping:", item.title);
			this.nextTrack(true, true);
			return;
		}

		this.log("playTrack: id=", item.id, "previewUrl=", item.previewUrl);
		this.$.AudioPlayer.load(item.previewUrl, item.id, item.libraryId);
		if (intStartTrackTime)
		{
			this.$.AudioPlayer.seekTo(intStartTrackTime);
		}
		if (forcePlay !== false)
		{
			this.$.AudioPlayer.play();
		}
		this.onAudioSrcChanged(null, boolForced);
	},

	onAudioBuffering: function (sender, payload)
	{
		this.doTrackBuffering(payload || {});
	},

	onAudioPlaying: function ()
	{
		this.log("Playback onAudioPlaying");
		this.doTrackPlaying();
		this.doTrackPausePlay(true);
		this.intErrorCount = 0;
	},

	onAudioPaused: function ()
	{
		this.doTrackPausePlay(false);
	},

	setTrackTime: function (intPos)
	{
		var duration = this.getTrackDuration();
		this.log();
		if (duration > 0)
		{
			this.$.AudioPlayer.seekTo(duration * intPos / 100);
		}
	},

	intUpdateRateChanged: function ()
	{
		// no-op: AudioPlayer pushes playback time updates via the audio element's timeupdate event
	},

	startTrackTimeUpdate: function ()
	{
		// no-op: AudioPlayer pushes playback time updates via the audio element's timeupdate event
	},

	updateTrackTime: function ()
	{
		if (!this.boolSuspendUpdates)
		{
			var objTrackTimes = {floatTrackCurrentTime: this.getTrackCurrentTime(), floatTrackDuration: this.getTrackDuration()};
			this.doUpdateTrackTime(objTrackTimes);
		}
	},

	stopTrackTimeUpdate: function ()
	{
		// no-op: AudioPlayer pushes playback time updates via the audio element's timeupdate event
	},

	onTimeChanged: function (sender, payload)
	{
		if (this.boolSuspendUpdates)
		{
			return;
		}
		this.doUpdateTrackTime({
			floatTrackCurrentTime: payload.currentTime,
			floatTrackDuration: payload.duration
		});
	},

	onAudioSrcChanged: function (sender, boolForced)
	{
		try
		{
			this.log();

			if (this.$.PlaybackList.getCurrentPlayBackItem())
			{
				var objTrackInfo = {strTrackArtist: this.getTrackArtist(),
									strTrackTitle: this.getTrackTitle(),
									strTrackAlbum: this.getTrackAlbum(),
									strTrackGenre: this.getTrackGenre(),
									strTrackImage: this.$.PlaybackList.getCurrentPlayBackItem().artUrl || "",
									intTrackIndex: this.$.PlaybackList.intCurrTrackIndex,
									intTrackOrigIndex: this.$.PlaybackList.getCurrentPlayBackItem().origIndex,
									strTrackID: this.getTrackID(),
									intTrackTime: this.getTrackCurrentTime(),
									intTrackDuration: this.getTrackDuration(),
									strTrackDuration: this.getTrackDuration(true),
									strListQuery: this.$.PlaybackList.getListQuery(),
									boolForced: boolForced};

				this.doTrackSrcChanged(objTrackInfo);
			}
		}
		catch(err)
		{
			this.log(err);
		}
	},

	onAudioError: function (sender, payload)
	{
		this.log("Audio playback error", payload && payload.error);
		this.stopTrackTimeUpdate();

		if (this.intErrorCount < this.INT_ERROR_MAX)
		{
			this.intErrorCount++;
			if (this.$.PlaybackList.getRepeatMode() === 2)
			{
				this.playCurrent();
			}
			else
			{
				this.nextTrack(true, true);
			}
		}
		else
		{
			this.log("Max errors reached, stopping playback");
			this.doTrackPausePlay(false);
		}
	},

	clickTrack: function(intClickedTrackIndex)
	{
		if (intClickedTrackIndex === this.$.PlaybackList.getCurrSongOrigIndex())
		{
			this.pausePlayback();
		}
		else
		{
			this.switchTrack(intClickedTrackIndex);
		}
	},

	switchTrack: function (intSetTrackIndex)
	{
		this.$.PlaybackList.switchTrack(intSetTrackIndex);
		this.playTrack();
	},

	nextTrack: function (boolForce, forcePlay)
	{
		this.log("nextTrack");
		if (this.$.PlaybackList.nextTrack(boolForce))
		{
			this.playTrack(0, boolForce, forcePlay);
		}
		else
		{
			this.pausePlayback(true);
		}
	},

	prevTrack: function (boolForce)
	{
		this.log("prevTrack");
		if (this.$.PlaybackList.prevTrack(this.getTrackCurrentTime(), boolForce))
		{
			this.playTrack(0, boolForce);
		}
	},

	shufflePlaylist: function (boolForceShuffle)
	{
		this.log();
		this.$.PlaybackList.shufflePlaylist(boolForceShuffle);
	},

	songListChanged: function (intCurrTrackOrigIndex)
	{
		this.log();
		this.$.PlaybackList.songListChanged(intCurrTrackOrigIndex);
	},

	sortSongList: function (strSortMode, boolSortAsc)
	{
	},

	setRepeatMode: function (intForceMode)
	{
		this.$.PlaybackList.setRepeatMode(intForceMode);
	},

	setVolume: function (intPos)
	{
		this.$.AudioPlayer.setVolume(intPos / 100);
	},

	// Pass a callback (receives a 0-100 slider position) to force a fresh read from the
	// service instead of the cached value - see AudioPlayer.getVolume.
	getVolume: function (callback)
	{
		if (callback)
		{
			this.$.AudioPlayer.getVolume(function (fraction) { callback(Math.round(fraction * 100)); });
			return;
		}
		return Math.round(this.$.AudioPlayer.getVolume() * 100);
	},

	onEnded: function()
	{
		if (!this.boolSuspendUpdates)
		{
			var objTrackTimes = {floatTrackCurrentTime: this.getTrackDuration(), floatTrackDuration: this.getTrackDuration()};
			this.doUpdateTrackTime(objTrackTimes);
		}
		this.doSongEnd();
	},

	getTrackTitle: function ()
	{
		return this.$.PlaybackList.getCurrentPlayBackItem().title;
	},

	getTrackArtist: function ()
	{
		return this.$.PlaybackList.getCurrentPlayBackItem().artist;
	},

	getTrackAlbum: function ()
	{
		return this.$.PlaybackList.getCurrentPlayBackItem().album;
	},

	getPlaybackListID: function ()
	{
		return this.$.PlaybackList.strOriginListID;
	},

	getTrackGenre: function ()
	{
		return this.$.PlaybackList.getCurrentPlayBackItem().genre;
	},

	getTrackCurrentTime: function (boolFormatted)
	{
		if (boolFormatted === undefined)
		{
			boolFormatted = false;
		}

		var intCurrentTime = this.$.AudioPlayer.getCurrentTime();
		if (!(Utilities.isNumeric(intCurrentTime) || intCurrentTime < 0))
		{
			intCurrentTime = 0;
		}

		if (boolFormatted)
		{
			return Utilities.formatTime(intCurrentTime);
		}
		else
		{
			return intCurrentTime;
		}
	},

	getTrackDuration: function (boolFormatted)
	{
		if (boolFormatted === undefined)
		{
			boolFormatted = false;
		}

		var intDuration = this.$.AudioPlayer.getDuration();
		if (!(Utilities.isNumeric(intDuration)))
		{
			intDuration = 0;
		}

		if (boolFormatted)
		{
			return Utilities.formatTime(intDuration);
		}
		else
		{
			return intDuration;
		}
	},

	getTrackPlaying: function ()
	{
		return this.$.AudioPlayer.isPlaying();
	},

	getTrackImage: function ()
	{
		return this.$.PlaybackList.getCurrentPlayBackImage();
	},

	getTrackIndex: function ()
	{
		return this.$.PlaybackList.getIntCurrTrackIndex();
	},

	getTrackID: function()
	{
		return this.$.PlaybackList.getCurrSongID();
	},

	getTrackList: function()
	{
		return this.$.PlaybackList.getPlaybackList();
	}
});
