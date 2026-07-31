/*globals Mojo, Promise */
/*
 * Db8Service - a thin Promise wrapper over palm://com.palm.db (db8), webOS's native
 * JSON database. Used to cache the user's Apple Music library so the Library views can
 * query it by kind/index natively and offline, instead of hitting Apple on every view.
 *
 * This is the Mojo port of the Enyo app's utility/db8.js (kindDB8). The public API is
 * IDENTICAL (put/find/del/merge/putKind/putPermissions, each returning a Promise), so
 * the ported settings-service and librarycache-service callers work unchanged.
 *
 * NOTE vs the Enyo version: kindDB8 needed a hand-rolled serial queue because Enyo
 * 0.10's PalmService fires ONE component-level onSuccess/onFailure, so only one call
 * could be in flight per service component. Mojo.Service.Request has no such limitation
 * - each request is its own object with its own callbacks - so this port drops the
 * queue entirely and every call is independent (safe under Promise.all, etc).
 */
var Db8Service = function () {};

Db8Service.prototype = {

	SERVICE: "palm://com.palm.db",

	_err: function (method, response) {
		if (typeof console !== "undefined" && console.error) {
			console.error("[db8] " + method + " FAILED: " +
				((response && (response.errorText || response.errorCode !== undefined)) ?
					("errorCode=" + response.errorCode + " errorText=" + response.errorText) :
					JSON.stringify(response)));
		}
	},

	// Core: fire one db8 method and resolve/reject its response.
	_call: function (method, params) {
		var self = this;
		return new Promise(function (resolve, reject) {
			new Mojo.Service.Request("palm://com.palm.db", {
				method: method,
				parameters: params || {},
				onSuccess: function (response) {
					// db8 normally routes returnValue:false to onFailure, but guard anyway.
					if (response && response.returnValue === false) {
						self._err(method, response);
						reject(response);
					} else {
						resolve(response);
					}
				},
				onFailure: function (error) {
					self._err(method, error);
					reject(error);
				}
			});
		});
	},

	// put: store an array of objects (each must carry _kind). Returns {results:[{id,rev}]}.
	put: function (objects) {
		return this._call("put", { objects: objects });
	},

	// find: query is {from:"<kind>", where:[...], orderBy:"<index>", limit:N, page:"..."}.
	find: function (query) {
		return this._call("find", { query: query });
	},

	// del: remove everything matching the query (purge so it's gone, not just flagged).
	del: function (query) {
		return this._call("del", { query: query, purge: true });
	},

	merge: function (query, props) {
		return this._call("merge", { query: query, props: props });
	},

	// Register a kind schema (idempotent - putKind updates if it exists).
	putKind: function (kindDef) {
		return this._call("putKind", kindDef);
	},

	// Grant access to a kind. webOS db8 denies access (even to the owner app) without
	// an explicit permission record.
	putPermissions: function (permissions) {
		return this._call("putPermissions", { permissions: permissions });
	}
};
