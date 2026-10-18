/*
OAuth Broker Helper - Enyo
 Version 0.1
 Created: 2026
 Author: webOS Archive community
 License: MIT
 Description: Signs a legacy webOS app into a modern OAuth service through the shared
    webOS OAuth broker (https://oauth.wosa.link). The device can't do OAuth itself
    (2009-era TLS can't reach the provider; old browsers can't render the consent
    screen), so the broker does it: the device shows a short code, the user finishes
    signing in on a real browser, and the device polls for the resulting tokens.
    Works for both broker flows — oauth2_authcode (Box, Google, …) and oauth1_xauth
    (Instapaper). See OAuthExample/CLAUDE.md and webos://knowledge/oauth.
 Source: Find the latest version and clean samples of how to use it on GitHub:
    https://github.com/webosarchive/webos-common

 Wire it up:
    // depends.js
    enyo.depends("../../Enyo/OAuthBroker-Helper.js", ...);

    // in your view's components:
    { kind: "Helpers.OAuthBroker", name: "broker", appName: "myapp",
      onCode: "showCode", onConnected: "storeTokens",
      onExpired: "codeExpired", onError: "brokerError" }

    // then, to begin:
    this.$.broker.start();
*/

//** Note: If you synced this file from a common repository, local edits may be over-written! */

enyo.kind({
    name: "Helpers.OAuthBroker",
    kind: "Component",              // non-visual — put it in any view's components

    published: {
        // The shared community broker. You normally don't change this.
        brokerBaseUrl: "https://oauth.wosa.link",
        // REQUIRED: the slug your app is registered under on the broker (the ?app=
        // value). Get one by opening a PR at
        // github.com/webOSArchive/oauth-broker-for-webos — see CLAUDE.md.
        appName: "",
        // How often to poll check-code, in ms. ~1.5s feels instant; the broker's
        // pollSeconds is a floor you're allowed to beat.
        pollMs: 1500
    },

    events: {
        // (inSender, codeInfo)  codeInfo = {code, useUrl, flow, appTitle, pollSeconds}
        // Show codeInfo.code and codeInfo.useUrl to the user. Polling has begun.
        onCode: "",
        // (inSender, tokens)  The "ready" record from the broker, returned ONCE.
        //   oauth2_authcode → tokens.access_token / refresh_token / expires_in
        //   oauth1_xauth    → tokens.oauth_token / oauth_token_secret / username
        // Persist what you need here; polling has stopped.
        onConnected: "",
        // (inSender)  The code expired or was already claimed (broker returned 404).
        // Ask the user to try again, then call start() for a fresh code.
        onExpired: "",
        // (inSender, message)  Couldn't reach the broker to get a code (network/TLS).
        onError: ""
    },

    // --- internal state ---
    _code: "",
    _timer: null,
    _done: false,

    create: function() {
        this.inherited(arguments);
        enyo.log("OAuthBroker helper created (app='" + this.appName + "')");
    },

    //#region Public — call these from your view

    // Begin sign-in: fetch a code, fire onCode, and start polling in the background.
    start: function() {
        if (!this.appName) {
            this.doError("OAuthBroker: set the 'appName' property before calling start().");
            return;
        }
        this._done = false;
        this._code = "";
        enyo.log("OAuthBroker: requesting a code for '" + this.appName + "'");
        this._get("get-code", "", enyo.bind(this, "_onCodeReply"));
    },

    // Stop polling (e.g. the user cancelled or left the sign-in screen).
    stop: function() {
        this._stopTimer();
    },

    // Force an immediate check now — wire this to a manual "Check now" button as a
    // fallback in case the background poll is slow.
    checkNow: function() {
        this._poll();
    },

    // OAuth2 only: swap an expired access token for a fresh one, server-side.
    // Fires onConnected with the new tokens, onExpired on a real invalid_grant
    // (the user must sign in again), or onError on a transient failure (keep your
    // existing tokens and try again later). oauth1_xauth tokens never expire.
    refresh: function(refreshToken) {
        this._get("refresh", "&refresh_token=" + encodeURIComponent(refreshToken),
                  enyo.bind(this, "_onRefreshReply"));
    },

    //#endregion

    //#region Private — used by the public methods, not meant to be called directly

    _url: function(endpoint, extra) {
        var u = this.brokerBaseUrl + "/" + endpoint + ".php?app=" +
                encodeURIComponent(this.appName);
        return extra ? (u + extra) : u;
    },

    // enyo.xhr goes through the same WebKit stack the rest of the app uses, so it
    // works wherever the user's broker connection works (e.g. via an SSL-bump proxy).
    _get: function(endpoint, extra, cb) {
        enyo.xhr.request({
            url: this._url(endpoint, extra),
            method: "GET",
            callback: function(inResponse, inXhr) { cb(inXhr); }
        });
    },

    // Defensive parse — old WebKit, so no assumptions about the response.
    _parse: function(xhr) {
        try {
            var t = xhr && xhr.responseText;
            return t ? JSON.parse(t) : null;
        } catch (e) {
            return null;
        }
    },

    _onCodeReply: function(xhr) {
        var j = this._parse(xhr);
        if (!j || !j.code || !j.useUrl) {
            enyo.error("OAuthBroker: bad get-code reply: " +
                       (xhr && String(xhr.responseText).slice(0, 160)));
            this.doError("Could not start sign-in. Check your connection and try again.");
            return;
        }
        this._code = j.code;
        enyo.log("OAuthBroker: code " + j.code + " @ " + j.useUrl + " (" + j.flow + ")");
        this.doCode(j);            // your view shows j.code + j.useUrl
        this._startTimer();
    },

    _startTimer: function() {
        this._stopTimer();
        this._timer = window.setInterval(enyo.bind(this, "_poll"), this.pollMs || 1500);
    },

    _stopTimer: function() {
        if (this._timer) {
            window.clearInterval(this._timer);
            this._timer = null;
        }
    },

    _poll: function() {
        if (this._done || !this._code) { this._stopTimer(); return; }
        this._get("check-code", "&code=" + encodeURIComponent(this._code),
                  enyo.bind(this, "_onPollReply"));
    },

    _onPollReply: function(xhr) {
        if (this._done) return;
        var j = this._parse(xhr);

        // Ready: oauth2 gives access_token, oauth1 gives oauth_token.
        if (j && j.status === "ready" && (j.access_token || j.oauth_token)) {
            this._done = true;
            this._stopTimer();
            enyo.log("OAuthBroker: connected");
            this.doConnected(j);
            return;
        }

        // 404 = the broker no longer knows this code (expired or already claimed).
        // Nothing to keep polling for — the user needs a fresh code.
        if (xhr && xhr.status === 404) {
            this._stopTimer();
            this._code = "";
            enyo.log("OAuthBroker: code expired");
            this.doExpired();
            return;
        }

        // Otherwise {status:"pending"} (or a transient blip) — keep polling silently.
    },

    _onRefreshReply: function(xhr) {
        var j = this._parse(xhr);
        if (j && j.status === "ready" && j.access_token) {
            this.doConnected(j);
        } else if (j && j.status === "invalid_grant") {
            this.doExpired();      // refresh token is truly dead — real logout
        } else {
            this.doError("Token refresh failed (transient) — keep existing tokens.");
        }
    }

    //#endregion
});
