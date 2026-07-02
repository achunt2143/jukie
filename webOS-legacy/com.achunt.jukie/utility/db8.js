/*globals enyo, Promise */
/*
 * kindDB8 - a thin Promise wrapper over palm://com.palm.db (db8), webOS's native
 * JSON database. Used to cache the user's Apple Music library so we can query it by
 * kind/index natively and offline, instead of hitting Apple on every view.
 *
 * Enyo 0.10 PalmService fires component-level onSuccess/onFailure (not per-call), so
 * each method has its own service component but they share a single pending resolver.
 * Callers MUST await each op before the next (the library sync does) - there is only
 * ever one in-flight db8 call at a time.
 */
enyo.kind({
	name: "kindDB8",
	kind: "Component",
	components: [
		{name: "svcPut",   kind: "PalmService", service: "palm://com.palm.db/", method: "put",   onSuccess: "_ok", onFailure: "_fail"},
		{name: "svcFind",  kind: "PalmService", service: "palm://com.palm.db/", method: "find",  onSuccess: "_ok", onFailure: "_fail"},
		{name: "svcDel",   kind: "PalmService", service: "palm://com.palm.db/", method: "del",   onSuccess: "_ok", onFailure: "_fail"},
		{name: "svcMerge", kind: "PalmService", service: "palm://com.palm.db/", method: "merge", onSuccess: "_ok", onFailure: "_fail"},
		{name: "svcPutKind", kind: "PalmService", service: "palm://com.palm.db/", method: "putKind", onSuccess: "_ok", onFailure: "_fail"},
		{name: "svcPutPerms", kind: "PalmService", service: "palm://com.palm.db/", method: "putPermissions", onSuccess: "_ok", onFailure: "_fail"}
	],

	create: function () {
		this.inherited(arguments);
		this._pending = null;
		this._queue = [];
	},

	// Enyo 0.10's PalmService fires ONE component-level onSuccess/onFailure, so only ONE
	// db8 call can genuinely be in flight per service component at a time. This used to
	// REJECT a second concurrent call outright ("await each op") - which was fine as long
	// as every caller was disciplined about awaiting serially, but it silently broke real
	// callers more than once (a Promise.all firing 3 reads at once all collided). Now it
	// QUEUES instead: any call made while one is in flight just waits its turn and runs
	// automatically once the current one resolves - same public API, safe under any
	// concurrency pattern (Promise.all, fire-and-forget background work, etc).
	_call: function (svc, params) {
		var self = this;
		return new Promise(function (resolve, reject) {
			self._queue.push({svc: svc, params: params || {}, resolve: resolve, reject: reject});
			self._pump();
		});
	},

	_pump: function () {
		if (this._pending || !this._queue.length) { return; }
		this._pending = this._queue.shift();
		this._pending.svc.call(this._pending.params);
	},

	_ok: function (inSender, inResponse) {
		var p = this._pending;
		this._pending = null;
		if (p) {
			if (inResponse && inResponse.returnValue === false) { p.reject(inResponse); }
			else { p.resolve(inResponse); }
		}
		this._pump();
	},

	_fail: function (inSender, inResponse) {
		var p = this._pending;
		this._pending = null;
		if (p) { p.reject(inResponse); }
		this._pump();
	},

	// put: store an array of objects (each must carry _kind). Returns {results:[{id,rev}]}.
	put: function (objects) {
		return this._call(this.$.svcPut, {objects: objects});
	},

	// find: query is {from:"<kind>", where:[...], orderBy:"<index>", limit:N, page:"..."}.
	find: function (query) {
		return this._call(this.$.svcFind, {query: query});
	},

	// del: remove everything matching the query (purge so it's gone, not just flagged).
	del: function (query) {
		return this._call(this.$.svcDel, {query: query, purge: true});
	},

	merge: function (query, props) {
		return this._call(this.$.svcMerge, {query: query, props: props});
	},

	// Register a kind schema (idempotent - putKind updates if it exists).
	putKind: function (kindDef) {
		return this._call(this.$.svcPutKind, kindDef);
	},

	// Grant access to a kind. webOS db8 denies access (even to the owner app) without
	// an explicit permission record.
	putPermissions: function (permissions) {
		return this._call(this.$.svcPutPerms, {permissions: permissions});
	}
});
