/*
 * Minimal ES5 fetch() polyfill backed by XMLHttpRequest, for legacy WebKit
 * (webOS 3.0.x / Enyo 0.10) where window.fetch does not exist. Covers the
 * subset AppleMusicService needs: GET/POST with headers, JSON
 * and text bodies, and a Response-like object exposing status/json()/text().
 * Not spec-complete (no streaming body, no AbortController support).
 */
(function (global) {
	"use strict";

	if (global.fetch) {
		return;
	}

	function headersToObject(rawHeaders) {
		var headers = {};
		var lines = (rawHeaders || "").split(/\r?\n/);
		var i;
		var idx;
		var key;
		var value;

		for (i = 0; i < lines.length; i++) {
			if (!lines[i]) {
				continue;
			}
			idx = lines[i].indexOf(":");
			if (idx === -1) {
				continue;
			}
			key = lines[i].substring(0, idx).trim().toLowerCase();
			value = lines[i].substring(idx + 1).trim();
			headers[key] = value;
		}

		return headers;
	}

	function FetchResponse(xhr) {
		this.status = xhr.status;
		this.ok = xhr.status >= 200 && xhr.status < 300;
		this.statusText = xhr.statusText;
		this._body = xhr.responseText;
		this._headers = headersToObject(xhr.getAllResponseHeaders && xhr.getAllResponseHeaders());
	}

	FetchResponse.prototype.json = function () {
		var body = this._body;
		return Promise.resolve().then(function () {
			return body ? JSON.parse(body) : null;
		});
	};

	FetchResponse.prototype.text = function () {
		var body = this._body;
		return Promise.resolve(body || "");
	};

	FetchResponse.prototype.headers = {
		get: function () { return null; }
	};

	global.fetch = function (url, options) {
		options = options || {};

		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest();
			var method = options.method || "GET";
			var headerName;

			xhr.open(method, url, true);

			if (options.headers) {
				for (headerName in options.headers) {
					if (options.headers.hasOwnProperty(headerName)) {
						xhr.setRequestHeader(headerName, options.headers[headerName]);
					}
				}
			}

			xhr.onload = function () {
				resolve(new FetchResponse(xhr));
			};

			xhr.onerror = function () {
				reject(new Error("Network request failed: " + method + " " + url));
			};

			xhr.ontimeout = function () {
				reject(new Error("Network request timed out: " + method + " " + url));
			};

			xhr.send(options.body || null);
		});
	};
}(window));
