/*
 * Minimal ES5 Promise/A+ polyfill for legacy WebKit (webOS 3.0.x / Enyo 0.10)
 * where window.Promise does not exist. Covers resolve/reject/then/catch/all,
 * which is the full surface this codebase's AppleMusicService/Playback/MediaIndex
 * rely on. Not a spec-complete implementation, but sufficient for our chains.
 */
(function (global) {
	"use strict";

	if (global.Promise) {
		return;
	}

	function isFunction(value) {
		return typeof value === "function";
	}

	function PolyfillPromise(executor) {
		var self = this;
		self._state = "pending";
		self._value = undefined;
		self._callbacks = [];

		function settle(state, value) {
			if (self._state !== "pending") {
				return;
			}
			if (state === "fulfilled" && value && isFunction(value.then)) {
				value.then(
					function (v) { settle("fulfilled", v); },
					function (e) { settle("rejected", e); }
				);
				return;
			}
			self._state = state;
			self._value = value;
			setTimeout(function () {
				var i;
				for (i = 0; i < self._callbacks.length; i++) {
					self._callbacks[i]();
				}
				self._callbacks = [];
			}, 0);
		}

		try {
			executor(
				function (value) { settle("fulfilled", value); },
				function (reason) { settle("rejected", reason); }
			);
		} catch (err) {
			settle("rejected", err);
		}
	}

	PolyfillPromise.prototype.then = function (onFulfilled, onRejected) {
		var self = this;
		return new PolyfillPromise(function (resolve, reject) {
			function handle() {
				try {
					if (self._state === "fulfilled") {
						if (isFunction(onFulfilled)) {
							resolve(onFulfilled(self._value));
						} else {
							resolve(self._value);
						}
					} else if (self._state === "rejected") {
						if (isFunction(onRejected)) {
							resolve(onRejected(self._value));
						} else {
							reject(self._value);
						}
					}
				} catch (err) {
					reject(err);
				}
			}

			if (self._state === "pending") {
				self._callbacks.push(handle);
			} else {
				setTimeout(handle, 0);
			}
		});
	};

	PolyfillPromise.prototype.catch = function (onRejected) {
		return this.then(null, onRejected);
	};

	PolyfillPromise.resolve = function (value) {
		return new PolyfillPromise(function (resolve) { resolve(value); });
	};

	PolyfillPromise.reject = function (reason) {
		return new PolyfillPromise(function (resolve, reject) { reject(reason); });
	};

	PolyfillPromise.all = function (promises) {
		return new PolyfillPromise(function (resolve, reject) {
			var results = [];
			var remaining = promises.length;
			var i;

			if (!remaining) {
				resolve(results);
				return;
			}

			function handleResult(index) {
				return function (value) {
					results[index] = value;
					remaining--;
					if (remaining === 0) {
						resolve(results);
					}
				};
			}

			for (i = 0; i < promises.length; i++) {
				PolyfillPromise.resolve(promises[i]).then(handleResult(i), reject);
			}
		});
	};

	global.Promise = PolyfillPromise;
}(window));
