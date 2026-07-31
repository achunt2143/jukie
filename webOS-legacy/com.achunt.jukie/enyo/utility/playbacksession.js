/*globals enyo, Promise, console */
/*
 * kindPlaybackSession - persists the CURRENT playback session (the queue, which track
 * in it, the position within that track, and the shuffle/repeat modes) in db8 as a
 * single com.achunt.jukie.playbacksession record, so Exhibition Mode can resume "where
 * we left off" when it's docked while Jukie itself isn't running.
 *
 * Same db8 singleton pattern as kindSettings, with two differences:
 *  - It carries its OWN kindDB8 (not the app-wide this.$.DB8 that LibraryCache/Settings
 *    share), so its frequent progress writes never contend with a long library sync on
 *    that one shared queue (see [[settings-save-db8-queue-bug]]).
 *  - The heavy part (the queue array) is only written by save(); the frequent
 *    position/index updates go through saveProgress(), which db8-MERGEs just those few
 *    fields onto the existing record instead of rewriting the whole queue each tick.
 */
enyo.kind({
	name: "kindPlaybackSession",
	kind: "Component",
	components: [
		{name: "db8", kind: "kindDB8"}
	],

	KIND: "com.achunt.jukie.playbacksession:1",

	// A queue can be the whole sorted library (hundreds of tracks); cap what we persist so
	// the single db8 doc stays a sane size. Keeps the current track plus a big window ahead
	// (the "rest" to play) and a little behind (for Prev).
	MAX_QUEUE: 400,
	KEEP_BEHIND: 40,

	// Only these fields are needed to play (id/previewUrl/libraryId) and to display a track;
	// persisting lean refs keeps the doc small vs. the full library records.
	REF_FIELDS: ["id", "libraryId", "previewUrl", "title", "artist", "album", "genre", "artUrl", "trackNumber", "durationMs", "playable"],

	log: function () {
		if (typeof console !== "undefined" && console.log) {
			var parts = [], a = arguments, i;
			for (i = 0; i < a.length; i++) {
				parts.push((typeof a[i] === "object") ? JSON.stringify(a[i]) : ("" + a[i]));
			}
			console.log("[PlaybackSession] " + parts.join(" "));
		}
	},

	ensureSchema: function () {
		var self = this;
		var kindDef = {
			id: this.KIND,
			owner: "com.achunt.jukie",
			indexes: [{name: "bySingleton", props: [{name: "singleton"}]}]
		};
		var perms = [{
			type: "db.kind",
			object: this.KIND,
			caller: "com.achunt.jukie",
			operations: {read: "allow", create: "allow", update: "allow", delete: "allow"}
		}];
		// putKind FIRST, then putPermissions (see kindSettings for why this order).
		return this.$.db8.putKind(kindDef)
			.then(function () { return self.$.db8.putPermissions(perms); })
			.catch(function (err) { self.log("ensureSchema warning:", err); });
	},

	_leanRef: function (track) {
		var ref = {}, i, f;
		if (!track) { return ref; }
		for (i = 0; i < this.REF_FIELDS.length; i++) {
			f = this.REF_FIELDS[i];
			if (track[f] !== undefined && track[f] !== null) { ref[f] = track[f]; }
		}
		return ref;
	},

	// Window a possibly-huge queue down to MAX_QUEUE around the current index, returning the
	// windowed lean queue and the index re-based into it.
	_windowQueue: function (queue, index) {
		var start = 0;
		if (queue.length > this.MAX_QUEUE) {
			start = Math.max(0, index - this.KEEP_BEHIND);
			if (start + this.MAX_QUEUE > queue.length) {
				start = Math.max(0, queue.length - this.MAX_QUEUE);
			}
		}
		var slice = queue.slice(start, start + this.MAX_QUEUE);
		var lean = [];
		for (var i = 0; i < slice.length; i++) { lean.push(this._leanRef(slice[i])); }
		return {queue: lean, index: index - start};
	},

	// Persist the whole session. `snap` is kindPlayback.getSessionSnapshot(). Always
	// resolves (a failed save must never break playback).
	save: function (snap) {
		var self = this;
		if (!snap || !snap.queue || !snap.queue.length) {
			return Promise.resolve(false);
		}
		var windowed = this._windowQueue(snap.queue, snap.index || 0);
		var rec = {
			_kind: this.KIND,
			singleton: true,
			queue: windowed.queue,
			index: windowed.index,
			position: snap.position || 0,
			playing: !!snap.playing,
			shuffle: !!snap.shuffle,
			repeat: snap.repeat || 0,
			originListID: snap.originListID || "",
			listQuery: snap.listQuery || "{}",
			updatedAt: Date.now()
		};
		return this.ensureSchema()
			.then(function () {
				return self.$.db8.del({from: self.KIND, where: [{prop: "singleton", op: "=", val: true}]});
			})
			.then(function () { return self.$.db8.put([rec]); })
			.then(function () { self.log("saved session:", rec.queue.length, "tracks, index", rec.index); return true; })
			.catch(function (err) { self.log("save failed:", err); return false; });
	},

	// Lightweight update of just the progress fields (no queue rewrite). MERGE onto the
	// existing singleton; if there is no record yet it's a harmless no-op (the next full
	// save() creates it). Always resolves.
	saveProgress: function (index, position, playing) {
		var self = this;
		var props = {index: index || 0, position: position || 0, playing: !!playing, updatedAt: Date.now()};
		return this.ensureSchema()
			.then(function () {
				return self.$.db8.merge({from: self.KIND, where: [{prop: "singleton", op: "=", val: true}]}, props);
			})
			.catch(function (err) { self.log("saveProgress failed:", err); return false; });
	},

	// Load the saved session, or null if none. Always resolves.
	load: function () {
		var self = this;
		return this.ensureSchema()
			.then(function () {
				return self.$.db8.find({from: self.KIND, where: [{prop: "singleton", op: "=", val: true}], limit: 1});
			})
			.then(function (resp) {
				var rec = (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
				if (rec && rec.queue && rec.queue.length) {
					self.log("loaded session:", rec.queue.length, "tracks, index", rec.index, "pos", rec.position);
					return rec;
				}
				return null;
			})
			.catch(function (err) { self.log("load failed:", err); return null; });
	}
});
