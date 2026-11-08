/*globals Mojo, XMLHttpRequest, setInterval, clearInterval */
/*
 * BrokerService - signs in through the webOS OAuth broker (apple_musickit flow, the
 * `applemusic` app on the broker). Mojo port of the Enyo build's Helpers.OAuthBroker, trimmed
 * to the one flow Jukie uses: get-code, show the code, poll check-code until the Music User
 * Token arrives (once), done. Apple's own sign-in happens on the user's phone or computer.
 *
 * Requests are proxied through com.achunt.jukie.service (apiGet / jukie-drm) so modern TLS
 * handshakes succeed regardless of webOS 2.x's legacy OpenSSL 0.9.8 stack. Falls back to plain
 * XHR if the Luna service is unavailable.
 */
var BrokerService = function () {
	this.baseUrl = "https://oauth.wosa.link";
	this.appName = "applemusic";
	this.pollMs = 1500;
	this.code = "";
	this.timer = null;
	this.done = true;
	this.handlers = {};
};

BrokerService.prototype.CANDIDATE_URLS = [
	"https://oauth.wosa.link"
];

BrokerService.prototype._urlFor = function (base, endpoint, extra) {
	return base + "/" + endpoint + ".php?app=" + encodeURIComponent(this.appName) + (extra || "");
};

BrokerService.prototype._url = function (endpoint, extra) {
	return this._urlFor(this.baseUrl, endpoint, extra);
};

BrokerService.prototype._fetch = function (url, cb) {
	if (typeof Mojo !== "undefined" && Mojo.Service && Mojo.Service.Request) {
		new Mojo.Service.Request("palm://com.achunt.jukie.service/", {
			method: "apiGet",
			parameters: { path: url },
			onSuccess: function (response) {
				var json = (response && response.json) || null;
				cb(200, json);
			},
			onFailure: function (response) {
				var status = 500;
				if (response && response.error) {
					var m = /HTTP\s+(\d+)/i.exec(response.error);
					if (m) { status = parseInt(m[1], 10); }
				}
				cb(status, (response && response.json) || null);
			}
		});
		return;
	}
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) {
			var j = null;
			try { j = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {}
			cb(xhr.status, j);
		}
	};
	xhr.open("GET", url, true);
	xhr.send(null);
};

BrokerService.prototype.activateUrl = function (code) {
	var c = code || this.code;
	return this.baseUrl + "/activate.php?app=" + encodeURIComponent(this.appName) +
		"&code=" + encodeURIComponent(c);
};

// handlers: onCode({code, useUrl}), onConnected(tokens), onExpired(), onError(message)
BrokerService.prototype.start = function (handlers) {
	var self = this;
	this.stop();
	this.handlers = handlers || {};
	this.done = false;
	this.code = "";

	var candidates = this.CANDIDATE_URLS.slice();
	function tryNextCandidate() {
		if (self.done) { return; }
		if (candidates.length === 0) {
			self.done = true;
			if (self.handlers.onError) {
				self.handlers.onError("Could not reach sign-in service. Check connection and try again.");
			}
			return;
		}
		var base = candidates.shift();
		var url = self._urlFor(base, "get-code", "");
		self._fetch(url, function (status, j) {
			if (self.done) { return; }
			if (status === 200 && j && j.code) {
				self.baseUrl = base;
				self.code = j.code;
				if (self.handlers.onCode) { self.handlers.onCode(j); }
				self.timer = setInterval(function () { self.checkNow(); }, self.pollMs);
			} else {
				tryNextCandidate();
			}
		});
	}

	tryNextCandidate();
};

BrokerService.prototype.stop = function () {
	this.done = true;
	if (this.timer) {
		clearInterval(this.timer);
		this.timer = null;
	}
};

BrokerService.prototype.checkNow = function () {
	var self = this;
	if (this.done || !this.code) { return; }
	var url = this._url("check-code", "&code=" + encodeURIComponent(this.code));
	this._fetch(url, function (status, j) {
		if (self.done) { return; }
		if (status === 200 && j && j.status === "ready" && (j.music_user_token || j.access_token)) {
			self.stop();
			if (self.handlers.onConnected) { self.handlers.onConnected(j); }
			return;
		}
		// 404: the broker no longer knows this code (expired, or already claimed).
		if (status === 404) {
			self.stop();
			if (self.handlers.onExpired) { self.handlers.onExpired(); }
		}
		// Otherwise {status:"pending"} or a transient blip - keep polling.
	});
};
