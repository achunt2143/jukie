/*globals window, setTimeout */
/*
 * JukieLunacy - "are we running on Lunacy (webOS on Android)?", answered by asking Lunacy.
 *
 * PalmSystem.deviceInfo can't tell: Lunacy presents a TouchPad identity (webOS 3.x) when the
 * phone is unfolded/a tablet - which is why the launch switcher sends it to this Enyo build -
 * and a Pre3 identity otherwise, both indistinguishable from the real devices. Lunacy's own
 * bus service (palm://org.webosarchive.lunacy) exists only there, so a successful
 * getEnvironment call is the reliable signal. Mirrors Jukie.detectLunacy in the Mojo build
 * (mojo/app/controllers/app-assistant.js).
 *
 * Uses the raw PalmServiceBridge so it needs no Enyo component and can run before the app
 * tree exists. Never hangs: an unanswered probe settles to "not Lunacy" after 4s.
 *
 *   JukieLunacy.detect()            start the probe (idempotent)
 *   JukieLunacy.state               undefined until known, then true/false
 *   JukieLunacy.isLunacy()          true only once known to be Lunacy
 *   JukieLunacy.whenKnown(fn)       fn(isLunacy) once known (immediately if already)
 */
var JukieLunacy = {
	state: undefined,
	_asked: false,
	_waiters: [],

	_settle: function (isLunacy) {
		if (this.state !== undefined) { return; }
		this.state = !!isLunacy;
		var ws = this._waiters.splice(0, this._waiters.length), i;
		for (i = 0; i < ws.length; i++) {
			try { ws[i](this.state); } catch (e) { /* one waiter's failure must not block the rest */ }
		}
	},

	detect: function () {
		var self = this;
		if (this._asked) { return; }
		this._asked = true;
		try {
			var bridge = new window.PalmServiceBridge();
			bridge.onservicecallback = function (msg) {
				var ok = false;
				try { ok = JSON.parse(msg).returnValue !== false; } catch (e) { ok = false; }
				self._settle(ok);
			};
			bridge.call("palm://org.webosarchive.lunacy/system/getEnvironment", "{}");
		} catch (err) {
			this._settle(false);
		}
		setTimeout(function () { self._settle(false); }, 4000);
	},

	isLunacy: function () { return this.state === true; },

	whenKnown: function (fn) {
		if (this.state !== undefined) { fn(this.state); return; }
		this._waiters.push(fn);
		this.detect();
	}
};
