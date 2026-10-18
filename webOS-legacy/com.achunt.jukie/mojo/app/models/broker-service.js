/*globals XMLHttpRequest */
/*
 * BrokerService - signs in through the webOS OAuth broker (apple_musickit flow, the
 * `applemusic` app on the broker). Mojo port of the Enyo build's Helpers.OAuthBroker, trimmed
 * to the one flow Jukie uses: get-code, show the code, poll check-code until the Music User
 * Token arrives (once), done. Apple's own sign-in happens on the user's phone or computer.
 *
 * Plain XHR rather than fetch so there is nothing to wait on at boot. Whether this device's
 * WebKit can complete TLS to the broker is not guaranteed on 2.x (it cannot to Apple's hosts).
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

BrokerService.prototype._url = function (endpoint, extra) {
	return this.baseUrl + "/" + endpoint + ".php?app=" + encodeURIComponent(this.appName) + (extra || "");
};

BrokerService.prototype._get = function (endpoint, extra, cb) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4) { cb(xhr); }
	};
	xhr.open("GET", this._url(endpoint, extra), true);
	xhr.send(null);
};

BrokerService.prototype._parse = function (xhr) {
	try {
		return xhr.responseText ? JSON.parse(xhr.responseText) : null;
	} catch (e) {
		return null;
	}
};

BrokerService.prototype.activateUrl = function () {
	return this.baseUrl + "/activate.php?app=" + encodeURIComponent(this.appName) +
		"&code=" + encodeURIComponent(this.code);
};

// handlers: onCode({code, useUrl}), onConnected(tokens), onExpired(), onError(message)
BrokerService.prototype.start = function (handlers) {
	var self = this;
	this.stop();
	this.handlers = handlers || {};
	this.done = false;
	this.code = "";
	this._get("get-code", "", function (xhr) {
		var j = self._parse(xhr);
		if (self.done) { return; }
		if (!j || !j.code || !j.useUrl) {
			self.done = true;
			if (self.handlers.onError) { self.handlers.onError("Could not start sign-in. Check your connection and try again."); }
			return;
		}
		self.code = j.code;
		if (self.handlers.onCode) { self.handlers.onCode(j); }
		self.timer = setInterval(function () { self.checkNow(); }, self.pollMs);
	});
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
	this._get("check-code", "&code=" + encodeURIComponent(this.code), function (xhr) {
		var j = self._parse(xhr);
		if (self.done) { return; }
		if (j && j.status === "ready" && (j.music_user_token || j.access_token)) {
			self.stop();
			if (self.handlers.onConnected) { self.handlers.onConnected(j); }
			return;
		}
		// 404: the broker no longer knows this code (expired, or already claimed).
		if (xhr.status === 404) {
			self.stop();
			if (self.handlers.onExpired) { self.handlers.onExpired(); }
		}
		// Otherwise {status:"pending"} or a transient blip - keep polling.
	});
};
