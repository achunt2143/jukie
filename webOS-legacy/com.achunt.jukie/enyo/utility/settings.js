/*globals enyo, Promise, console */
/*
 * kindSettings - persists user preferences (Apple Music tokens, cache + quality
 * options) in db8 as a single com.achunt.jukie.prefs record. Tokens entered here
 * override the build-time window.APPLE_MUSIC_* defaults, so a user without the
 * git-ignored dev-token.local.js can still sign in, and the ~35-day web developer
 * token can be refreshed without a rebuild. See [[webos-sdk-local]].
 *
 * Uses the same db8 wrapper + register-schema-at-runtime pattern as kindLibraryCache
 * (palm-install doesn't process configuration/db on the device).
 */
enyo.kind({
	name: "kindSettings",
	kind: "Component",
	published: {db8: null},

	KIND: "com.achunt.jukie.prefs:1",

	defaults: function () {
		return {
			developerToken: "",
			musicUserToken: "",
			storefront: "us",
			cacheEnabled: true,
			streamQuality: "high"
		};
	},

	log: function () {
		if (typeof console !== "undefined" && console.log) {
			var parts = [], a = arguments, i;
			for (i = 0; i < a.length; i++) {
				parts.push((typeof a[i] === "object") ? JSON.stringify(a[i]) : ("" + a[i]));
			}
			console.log("[Settings] " + parts.join(" "));
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
		// putKind FIRST (an app can always register its OWN kind), THEN putPermissions.
		// putPermissions before putKind fails with "kind not registered" on a brand-new
		// kind (the library kind only "worked" that way because the configurator had
		// pre-registered it from configuration/db/kinds/). Verified on-device.
		return this.db8.putKind(kindDef)
			.then(function () { return self.db8.putPermissions(perms); })
			.catch(function (err) { self.log("ensureSchema warning:", err); });
	},

	// Load the single prefs record, merged over defaults. Always resolves (falls back
	// to defaults on any db8 error) so the app boot path never blocks on settings.
	load: function () {
		var self = this;
		return this.ensureSchema()
			.then(function () {
				return self.db8.find({from: self.KIND, where: [{prop: "singleton", op: "=", val: true}], limit: 1});
			})
			.then(function (resp) {
				var d = self.defaults();
				var rec = (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
				var k;
				if (rec) {
					for (k in d) {
						if (d.hasOwnProperty(k) && rec[k] !== undefined) { d[k] = rec[k]; }
					}
				}
				return d;
			})
			.catch(function (err) { self.log("load failed:", err); return self.defaults(); });
	},

	// Replace the single prefs record. Returns the stored object.
	save: function (settings) {
		var self = this;
		var rec = this.defaults();
		var k;
		for (k in rec) {
			if (rec.hasOwnProperty(k) && settings[k] !== undefined) { rec[k] = settings[k]; }
		}
		rec._kind = this.KIND;
		rec.singleton = true;
		return this.ensureSchema()
			.then(function () {
				return self.db8.del({from: self.KIND, where: [{prop: "singleton", op: "=", val: true}]});
			})
			.then(function () { return self.db8.put([rec]); })
			.then(function () { self.log("saved"); return rec; });
	}
});
