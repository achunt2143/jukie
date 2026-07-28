/*globals window, fetch, Promise, WebToken:true */
/*
 * WebToken - client-side port of jukie-drm's internal/appleauth/webtoken.go: scrapes
 * music.apple.com for the PUBLIC "AMPWebPlay" web-player developer token (~35-day JWT,
 * no login needed - it's baked into the site for anyone visiting). jukie-drm already
 * auto-refreshes its OWN copy of this token for full-track playback; this app's own
 * catalog/library browsing (AppleMusicService) had no equivalent, so a manually-pasted
 * Settings token going stale silently broke "Your Library" - see [[settings-save-db8-queue-bug]]
 * memory / the 2026-07-27 session that found the 401.
 *
 * CONFIRMED WORKING on-device (2026-07-27), somewhat surprisingly: jukie-drm's own fetch
 * runs in a separate Go process with no browser-style cross-origin restrictions, but this
 * app's fetch() (utility/fetch-polyfill.js, backed by XMLHttpRequest) had no such
 * guarantee - a modern browser would block reading a cross-origin response body without
 * matching CORS headers, which music.apple.com's page/bundle responses don't send. This
 * old webOS 3.x WebKit apparently doesn't enforce that restriction: a forced end-to-end
 * test (GET /us/browse -> scan its JS bundles -> find + apply a real, currently-valid
 * AMPWebPlay token) succeeded, and the token verified byte-identical (by hash) to one
 * independently scraped straight from Apple's live site outside the app. If Apple or a
 * future webOS/WebAppMgr patch ever changes this, every call here just fails
 * (rejects/logs) and callers fall back to whatever token they already had - no worse off
 * than before this file existed.
 */
(function (global) {
    "use strict";

    var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    // Kept short: this can run reactively off a live 401 (see applemusicservice.js's
    // request()), and worst case (every fetch times out rather than failing fast) is
    // roughly TOKEN_PAGES.length * (1 + MAX_BUNDLES_TO_SCAN) * FETCH_TIMEOUT_MS before
    // giving up - a real user-visible stall if set too generously.
    var FETCH_TIMEOUT_MS = 8000;
    var MAX_BUNDLES_TO_SCAN = 2;
    var REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000; // refresh a day before actual expiry, matching jukie-drm

    var TOKEN_PAGES = ["https://music.apple.com/us/browse", "https://music.apple.com/"];
    var JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}/g;
    var BUNDLE_RE = /\/assets\/[A-Za-z0-9_./-]*index[A-Za-z0-9_.-]*\.js/g;
    var SCRIPT_SRC_RE = /<script[^>]+src="([^"]+\.js)"/g;

    // Builds ONE string and makes a single console.log call, rather than
    // console.log.apply(console, [multiple, separate, args]) - confirmed on-device that
    // webOS's console->syslog bridge silently drops every argument past the first when
    // called that way (matches the pattern kindSettings.log already uses for the same
    // reason - see settings.js).
    function log() {
        var parts = ["[WebToken]"];
        var i;
        if (typeof console === "undefined" || !console.log) {
            return;
        }
        for (i = 0; i < arguments.length; i++) {
            parts.push((typeof arguments[i] === "object") ? JSON.stringify(arguments[i]) : ("" + arguments[i]));
        }
        console.log(parts.join(" "));
    }

    function b64urlDecode(s) {
        var padded = s + new Array((4 - (s.length % 4)) % 4 + 1).join("=");
        var normal = padded.replace(/-/g, "+").replace(/_/g, "/");
        return decodeURIComponent(escape(window.atob(normal)));
    }

    function jwtPayload(tok) {
        var parts = (tok || "").split(".");
        if (parts.length !== 3) {
            return null;
        }
        try {
            return JSON.parse(b64urlDecode(parts[1]));
        } catch (err) {
            return null;
        }
    }

    function jwtExpiry(tok) {
        var p = jwtPayload(tok);
        if (!p || typeof p.exp !== "number") {
            return null;
        }
        return new Date(p.exp * 1000);
    }

    function isWebDevToken(tok) {
        var p = jwtPayload(tok);
        return !!(p && p.root_https_origin && typeof p.exp === "number");
    }

    // First JWT that looks like the web dev token (root_https_origin + exp), else any
    // JWT carrying an exp - mirrors webtoken.go's findTokenInText.
    function findTokenInText(text) {
        var matches = text.match(JWT_RE) || [];
        var fallback = "";
        var i;
        for (i = 0; i < matches.length; i++) {
            if (isWebDevToken(matches[i])) {
                return matches[i];
            }
            if (!fallback && jwtExpiry(matches[i])) {
                fallback = matches[i];
            }
        }
        return fallback;
    }

    function bundleURLs(html) {
        var out = [];
        var seen = {};
        var m;

        function add(p) {
            var url;
            if (!p || seen[p] || p.indexOf(".js") === -1) {
                return;
            }
            seen[p] = true;
            if (p.indexOf("http") === 0) {
                url = p;
            } else if (p.indexOf("/") === 0) {
                url = "https://music.apple.com" + p;
            } else {
                return;
            }
            out.push(url);
        }

        BUNDLE_RE.lastIndex = 0;
        while ((m = BUNDLE_RE.exec(html))) {
            add(m[0]);
        }
        SCRIPT_SRC_RE.lastIndex = 0;
        while ((m = SCRIPT_SRC_RE.exec(html))) {
            add(m[1]);
        }
        return out.slice(0, MAX_BUNDLES_TO_SCAN);
    }

    function fetchTextWithTimeout(url) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) { return; }
                settled = true;
                reject(new Error("timed out: " + url));
            }, FETCH_TIMEOUT_MS);

            fetch(url, { method: "GET", headers: { "Accept": "text/html,application/javascript,*/*", "User-Agent": UA } })
                .then(function (response) {
                    if (settled) { return; }
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + " for " + url);
                    }
                    return response.text();
                })
                .then(function (text) {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(timer);
                    resolve(text);
                })
                .catch(function (err) {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    // Scrapes music.apple.com for the public web developer token. No auth. Rejects
    // (never throws synchronously) if nothing usable is found or every fetch failed
    // (most likely a cross-origin block - see file header).
    function fetchWebDeveloperToken() {
        var pageIdx = 0;

        function tryPage() {
            if (pageIdx >= TOKEN_PAGES.length) {
                return Promise.reject(new Error("no usable developer token found on music.apple.com"));
            }
            var page = TOKEN_PAGES[pageIdx];
            pageIdx += 1;
            log("GET", page);
            return fetchTextWithTimeout(page).then(function (html) {
                var inline = findTokenInText(html);
                if (inline) {
                    log("found token inline in HTML");
                    return inline;
                }
                var bundles = bundleURLs(html);
                log("scanning", bundles.length, "JS bundle(s)");
                return scanBundles(bundles, 0);
            }).catch(function (err) {
                log("  page failed:", page, err && err.message);
                return tryPage();
            });
        }

        function scanBundles(bundles, idx) {
            if (idx >= bundles.length) {
                return tryPage();
            }
            return fetchTextWithTimeout(bundles[idx]).then(function (js) {
                var tok = findTokenInText(js);
                if (tok) {
                    log("found token in bundle", bundles[idx]);
                    return tok;
                }
                return scanBundles(bundles, idx + 1);
            }).catch(function (err) {
                log("  bundle failed:", bundles[idx], err && err.message);
                return scanBundles(bundles, idx + 1);
            });
        }

        return tryPage().then(function (tok) {
            var expiry = jwtExpiry(tok);
            if (!expiry) {
                throw new Error("scraped token has no exp claim");
            }
            return { token: tok, expiry: expiry };
        });
    }

    function stillValid(tok) {
        var expiry = jwtExpiry(tok);
        return !!(tok && expiry && (expiry.getTime() - Date.now()) > REFRESH_MARGIN_MS);
    }

    // Resolves { token, changed } - `current` unchanged if still valid or if the fetch
    // fails (better stale than nothing, matching webtoken.go's EnsureWebToken). Never
    // rejects, so callers can fire this at boot without extra error handling. Pass
    // `force` to skip the exp-based validity check and re-scrape unconditionally
    // (used on a live 401 - the token's own exp claim can say "fine" while the server
    // disagrees, e.g. revoked).
    function ensure(current, force) {
        if (!force && stillValid(current)) {
            return Promise.resolve({ token: current, changed: false });
        }
        return fetchWebDeveloperToken().then(function (result) {
            if (result.token === current) {
                return { token: current, changed: false };
            }
            return { token: result.token, changed: true };
        }).catch(function (err) {
            log("auto-refresh unavailable (blocked or unreachable), keeping existing token:", err && err.message);
            return { token: current, changed: false };
        });
    }

    global.WebToken = {
        ensure: ensure,
        stillValid: stillValid,
        jwtExpiry: jwtExpiry
    };
}(window));
