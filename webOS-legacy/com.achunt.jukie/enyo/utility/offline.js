/*globals window */
/*
 * JukieOffline - plain shared state for "is the device online" and "which tracks play with no
 * network". Not an enyo kind: the song list rows read it on every row recycle
 * (listSetupRow), so it is just lookups on plain objects, and it has no db8 or Luna calls of
 * its own - app.js feeds it (connection manager + the service's listOffline) and repaints
 * the lists when it reports a change.
 *
 *   ids   - catalogId -> true for every track playable with no network (cached or saved)
 *   saved - catalogId -> true for the tracks the user chose to keep for offline play
 *
 * Mirrors the Mojo build's Jukie.online / offlineIds / savedIds (mojo/app/controllers/
 * app-assistant.js); the service (com.achunt.jukie.service) is the source of truth.
 */
var JukieOffline = {
	online: true,   // assume online until the connection manager says otherwise
	ids: {},
	saved: {},
	items: [],      // saved-song metadata from the service manifest
	_sig: "",

	// "" | "cached" | "saved" | "pending" (saved, still downloading or failed)
	state: function (id)
	{
		if (!id) { return ""; }
		if (this.saved[id]) { return this.ids[id] ? "saved" : "pending"; }
		return this.ids[id] ? "cached" : "";
	},

	// Offline and not on the device: shown dimmed, and skipped by next/prev.
	isUnavailable: function (id)
	{
		return !this.online && !!id && !this.ids[id];
	},

	// Playable right now. Tracks with no id (previews) are left to the existing rules.
	isPlayable: function (id)
	{
		return !id || this.online || !!this.ids[id];
	},

	// Returns true if the online flag actually changed.
	setOnline: function (online)
	{
		online = !!online;
		if (online === this.online) { return false; }
		this.online = online;
		return true;
	},

	// res = the service's listOffline response. Returns true if the sets changed.
	setFromList: function (res)
	{
		var ids = {}, saved = {}, i;
		for (i = 0; i < (res.available || []).length; i++) { ids[res.available[i]] = true; }
		for (i = 0; i < (res.pinned || []).length; i++) { saved[res.pinned[i]] = true; }
		var sig = (res.available || []).slice().sort().join(",") + "|" + (res.pinned || []).slice().sort().join(",");
		this.ids = ids;
		this.saved = saved;
		this.items = res.items || [];
		if (sig === this._sig) { return false; }
		this._sig = sig;
		return true;
	},

	// Optimistic local edit, so the badge flips at once; the next listOffline response
	// replaces it with the service's real state.
	markSaved: function (id, isSaved)
	{
		if (isSaved) { this.saved[id] = true; }
		else { delete this.saved[id]; delete this.ids[id]; }
		this._sig = "";
	}
};
