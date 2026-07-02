// Package appleauth obtains Apple Music credentials for Jukie.
//
// webtoken.go: fetch the PUBLIC first-party "web developer token" (the ~35-day
// AMPWebPlay token the music.apple.com player uses). This needs NO login - the
// token is baked into the site - so it can be auto-refreshed silently. jukie-drm
// uses it as the Bearer for play.music.apple.com webPlayback.
//
// The device's old curl can't TLS-handshake music.apple.com, but Go's HTTP client
// can (same as the existing play.music.apple.com calls), so this lives in Go.
package appleauth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// DefaultCacheDir is the jail-writable persistent dir on the TouchPad.
const DefaultCacheDir = "/media/internal/.jukie"

// Logf is an optional progress sink (set by the CLI to write to stderr). No-op by default.
var Logf = func(string, ...interface{}) {}

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Pages that carry the web player bootstrap (and thus the token).
var tokenPages = []string{
	"https://music.apple.com/us/browse",
	"https://music.apple.com/",
}

var (
	jwtRe       = regexp.MustCompile(`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{8,}`)
	bundleRe    = regexp.MustCompile(`/assets/[A-Za-z0-9_./-]*index[A-Za-z0-9_.-]*\.js`)
	scriptSrcRe = regexp.MustCompile(`<script[^>]+src="([^"]+\.js)"`)
)

// WebToken is a fetched first-party web developer token and its expiry.
type WebToken struct {
	Token  string    `json:"token"`
	Expiry time.Time `json:"expiry"`
}

// FetchWebToken scrapes music.apple.com for the first-party developer token. No auth.
func FetchWebToken(client *http.Client) (WebToken, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	var lastErr error
	for _, page := range tokenPages {
		Logf("GET %s", page)
		html, err := httpGet(client, page)
		if err != nil {
			Logf("  err: %v", err)
			lastErr = err
			continue
		}
		Logf("  %d bytes", len(html))
		// 1) token may be inline in the HTML (meta config or a raw JWT)
		if t, ok := validToken(findTokenInText(string(html))); ok {
			Logf("  found token inline in HTML")
			return t, nil
		}
		// 2) otherwise pull the JS bundles and scan them
		bundles := bundleURLs(string(html))
		Logf("  scanning %d JS bundle(s)", len(bundles))
		for _, u := range bundles {
			js, err := httpGet(client, u)
			if err != nil {
				Logf("    %s err: %v", u, err)
				continue
			}
			Logf("    %s (%d bytes)", u, len(js))
			if t, ok := validToken(findTokenInText(string(js))); ok {
				Logf("    found token in bundle")
				return t, nil
			}
		}
	}
	if lastErr != nil {
		return WebToken{}, fmt.Errorf("fetch music.apple.com: %w", lastErr)
	}
	return WebToken{}, fmt.Errorf("no usable developer token found on music.apple.com")
}

func httpGet(client *http.Client, u string) ([]byte, error) {
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/javascript,*/*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, u)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 12<<20)) // 12MB cap
}

// findTokenInText returns the first JWT that looks like the web dev token
// (has root_https_origin + exp), else any JWT carrying an exp.
func findTokenInText(s string) string {
	if dec, err := url.QueryUnescape(s); err == nil && dec != s {
		s = s + "\n" + dec // meta config is URL-encoded JSON
	}
	var fallback string
	for _, m := range jwtRe.FindAllString(s, -1) {
		if isWebDevToken(m) {
			return m
		}
		if fallback == "" && jwtExp(m) != nil {
			fallback = m
		}
	}
	return fallback
}

func bundleURLs(html string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		if p == "" || seen[p] || !strings.HasSuffix(p, ".js") {
			return
		}
		seen[p] = true
		switch {
		case strings.HasPrefix(p, "http"):
			out = append(out, p)
		case strings.HasPrefix(p, "/"):
			out = append(out, "https://music.apple.com"+p)
		}
	}
	for _, m := range bundleRe.FindAllString(html, -1) {
		add(m)
	}
	for _, m := range scriptSrcRe.FindAllStringSubmatch(html, -1) {
		add(m[1])
	}
	if len(out) > 6 {
		out = out[:6]
	}
	return out
}

// ---- JWT helpers ----

func jwtPayload(tok string) map[string]interface{} {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var m map[string]interface{}
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

func jwtExp(tok string) *time.Time {
	m := jwtPayload(tok)
	if m == nil {
		return nil
	}
	if e, ok := m["exp"].(float64); ok {
		t := time.Unix(int64(e), 0)
		return &t
	}
	return nil
}

func isWebDevToken(tok string) bool {
	m := jwtPayload(tok)
	if m == nil {
		return false
	}
	_, hasOrigin := m["root_https_origin"]
	_, hasExp := m["exp"]
	return hasOrigin && hasExp
}

func validToken(tok string) (WebToken, bool) {
	if tok == "" {
		return WebToken{}, false
	}
	exp := jwtExp(tok)
	if exp == nil {
		return WebToken{}, false
	}
	return WebToken{Token: tok, Expiry: *exp}, true
}

// ---- cache + ensure ----

func webTokenCachePath(dir string) string {
	if dir == "" {
		dir = DefaultCacheDir
	}
	return filepath.Join(dir, "webtoken.cache.json")
}

// LoadCachedWebToken returns a cached token if present and not within a day of expiry.
func LoadCachedWebToken(dir string) (WebToken, bool) {
	b, err := os.ReadFile(webTokenCachePath(dir))
	if err != nil {
		return WebToken{}, false
	}
	var t WebToken
	if json.Unmarshal(b, &t) != nil || t.Token == "" {
		return WebToken{}, false
	}
	if time.Until(t.Expiry) < 24*time.Hour {
		return WebToken{}, false
	}
	return t, true
}

// SaveCachedWebToken writes the token to the cache dir (best-effort).
func SaveCachedWebToken(dir string, t WebToken) error {
	if dir == "" {
		dir = DefaultCacheDir
	}
	if err := os.MkdirAll(dir, 0777); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(t, "", "  ")
	return os.WriteFile(webTokenCachePath(dir), b, 0666)
}

// EnsureWebToken returns a valid web token: prefer `current` if still valid, else the
// cache, else a fresh fetch (which it caches). Falls back to `current` on fetch failure.
func EnsureWebToken(dir string, client *http.Client, current string) (string, error) {
	if tokenStillValid(current) {
		return current, nil
	}
	if t, ok := LoadCachedWebToken(dir); ok {
		return t.Token, nil
	}
	t, err := FetchWebToken(client)
	if err != nil {
		if current != "" {
			return current, nil // better stale than nothing
		}
		return "", err
	}
	_ = SaveCachedWebToken(dir, t)
	return t.Token, nil
}

func tokenStillValid(tok string) bool {
	if tok == "" {
		return false
	}
	exp := jwtExp(tok)
	return exp != nil && time.Until(*exp) > 24*time.Hour
}
