// Package apple implements a client for Apple Music's web-player playback API: it
// requests the playback manifest for a track, then does the Widevine license exchange
// needed to obtain that track's content keys.
//
// Flow:
//  1. WebPlayback(adamID)         -> manifest URL (ctrp256 = Widevine), cert URL, license URL
//  2. WidevinePSSH(manifestURL)   -> the Widevine init data (PSSH) from the manifest
//  3. WidevineCert(certURL)       -> Widevine service certificate (for privacy-mode challenge)
//  4. <CDM builds challenge>      (see internal/cdm)
//  5. AcquireLicense(...)         -> license bytes (CDM parses these into content keys)
//
// All requests authenticate with the first-party web developer token + music user token.
package apple

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	webPlaybackURL = "https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback"
	widevineKeyFmt = "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"
	keySystem      = "com.widevine.alpha"
)

// Client talks to Apple Music with web-player credentials.
type Client struct {
	WebToken  string // first-party AMPWebPlay developer token
	UserToken string // music user token
	HTTP      *http.Client
}

func New(webToken, userToken string) *Client {
	// http.Client.Timeout covers the whole request including reading the body, not
	// just headers/connect. This device's network is slow/flaky enough that even a
	// ~1-2MB track download can exceed 30s (confirmed on-device: "context deadline
	// exceeded ... while reading body" mid-download) - these fetches already run in
	// the background behind a "buffering" state, so there's no UI reason to keep
	// this tight.
	return &Client{WebToken: webToken, UserToken: userToken, HTTP: &http.Client{Timeout: 120 * time.Second}}
}

func (c *Client) auth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.WebToken)
	req.Header.Set("x-apple-music-user-token", c.UserToken)
	req.Header.Set("Origin", "https://music.apple.com")
	req.Header.Set("Referer", "https://music.apple.com/")
	req.Header.Set("Accept", "application/json")
}

// Playback holds the bits we need from a webPlayback response.
type Playback struct {
	SongID      string
	ManifestURL string // the ctrp256 (Widevine) HLS manifest
	CertURL     string // widevine-cert-url
	LicenseURL  string // hls-key-server-url (acquireWebPlaybackLicense)
	DurationMs  int
	Title       string
	Artist      string
}

type webPlaybackResp struct {
	SongList []struct {
		Assets []struct {
			Flavor   string `json:"flavor"`
			URL      string `json:"URL"`
			Metadata struct {
				Duration int    `json:"duration"`
				ItemName string `json:"itemName"`
				Artist   string `json:"artistName"`
			} `json:"metadata"`
		} `json:"assets"`
		WidevineCertURL string `json:"widevine-cert-url"`
		HLSKeyServerURL string `json:"hls-key-server-url"`
		SongID          string `json:"songId"`
	} `json:"songList"`
	Status int `json:"status"`
}

// WebPlayback fetches the playback assets and selects the Widevine (ctrp256) one.
// libraryID may be "" for catalog tracks.
func (c *Client) WebPlayback(adamID, libraryID string) (*Playback, error) {
	reqBody := map[string]string{"subscriptionAdamId": adamID}
	if libraryID != "" {
		reqBody["universalLibraryId"] = libraryID
	}
	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", webPlaybackURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	c.auth(req)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("webPlayback HTTP %d: %s", resp.StatusCode, truncate(raw, 300))
	}

	var wp webPlaybackResp
	if err := json.Unmarshal(raw, &wp); err != nil {
		return nil, fmt.Errorf("decode webPlayback: %w", err)
	}
	if len(wp.SongList) == 0 {
		return nil, fmt.Errorf("webPlayback: empty songList: %s", truncate(raw, 300))
	}
	s := wp.SongList[0]
	pb := &Playback{SongID: s.SongID, CertURL: s.WidevineCertURL, LicenseURL: s.HLSKeyServerURL}

	// Pick the Widevine flavor: "ctr" = CTR encryption (Widevine); prefer 256k.
	for _, a := range s.Assets {
		if strings.Contains(a.Flavor, "ctrp256") {
			pb.ManifestURL, pb.DurationMs = a.URL, a.Metadata.Duration
			pb.Title, pb.Artist = a.Metadata.ItemName, a.Metadata.Artist
		}
	}
	if pb.ManifestURL == "" { // fall back to any ctr flavor
		for _, a := range s.Assets {
			if strings.Contains(a.Flavor, "ctr") {
				pb.ManifestURL = a.URL
			}
		}
	}
	if pb.ManifestURL == "" {
		flavors := make([]string, len(s.Assets))
		for i, a := range s.Assets {
			flavors[i] = a.Flavor
		}
		return nil, fmt.Errorf("no Widevine (ctr) flavor; got flavors %v", flavors)
	}
	return pb, nil
}

// Apple's ctrp (Widevine/CENC) manifest signals the key as:
//   #EXT-X-KEY:METHOD=ISO-23001-7,URI="data:;base64,<keyId>"
// (no KEYFORMAT, no pssh box anywhere). FairPlay lines use skd:// instead, so any
// EXT-X-KEY line carrying a data:base64 URI is the Widevine one.
var dataKeyRe = regexp.MustCompile(`#EXT-X-(?:SESSION-)?KEY:[^\n]*URI="(data:[^;,]*;base64,([A-Za-z0-9+/=]+))"`)
var subManifestRe = regexp.MustCompile(`(?m)^[^#\n].*\.m3u8.*$`)

// WidevinePSSH walks the HLS manifest (master -> media playlist) and returns the
// Widevine init data (the CENC key-ID bytes), base64-decoded, plus the exact key
// URI string (which Apple wants echoed back in the license request's "uri" field).
func (c *Client) WidevinePSSH(manifestURL string) (initData []byte, keyURI string, err error) {
	text, err := c.getText(manifestURL)
	if err != nil {
		return nil, "", err
	}
	if m := dataKeyRe.FindStringSubmatch(text); m != nil {
		b, derr := base64.StdEncoding.DecodeString(m[2])
		return b, m[1], derr
	}
	// Not in this playlist: follow the first sub-playlist (master -> media).
	if ref := subManifestRe.FindString(text); ref != "" {
		return c.WidevinePSSH(resolveRef(manifestURL, strings.TrimSpace(ref)))
	}
	return nil, "", fmt.Errorf("no Widevine (data:base64) EXT-X-KEY found in manifest %s", manifestURL)
}

// WidevineCert fetches the Widevine service certificate.
func (c *Client) WidevineCert(certURL string) ([]byte, error) {
	url := certURL
	if !strings.Contains(url, "?") {
		url += fmt.Sprintf("?t=%d", time.Now().UnixMilli())
	}
	req, _ := http.NewRequest("GET", url, nil)
	c.auth(req)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("widevineCert HTTP %d", resp.StatusCode)
	}
	return b, nil
}

type licenseResp struct {
	License   string `json:"license"`
	ErrorCode int    `json:"errorCode"`
	Status    int    `json:"status"`
}

// AcquireLicense posts the Widevine challenge to Apple's license server and returns
// the raw license bytes (base64-decoded) for the CDM to parse. uri is the manifest's
// key URI (the "data:...;base64,..." value returned by WidevinePSSH).
func (c *Client) AcquireLicense(pb *Playback, challenge []byte, uri string) ([]byte, error) {
	body, _ := json.Marshal(map[string]any{
		"challenge":      base64.StdEncoding.EncodeToString(challenge),
		"uri":            uri,
		"key-system":     keySystem,
		"adamId":         pb.SongID,
		"isLibrary":      true,
		"user-initiated": true,
	})
	req, _ := http.NewRequest("POST", pb.LicenseURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-apple-renewal", "true")
	c.auth(req)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("acquireLicense HTTP %d: %s", resp.StatusCode, truncate(raw, 300))
	}
	var lr licenseResp
	if err := json.Unmarshal(raw, &lr); err != nil {
		return nil, fmt.Errorf("decode license: %w", err)
	}
	if lr.Status != 0 || lr.ErrorCode != 0 {
		return nil, fmt.Errorf("license error: status=%d errorCode=%d", lr.Status, lr.ErrorCode)
	}
	return base64.StdEncoding.DecodeString(lr.License)
}

// MediaFileURL walks the HLS manifest (master -> media playlist) and returns the
// absolute URL of the underlying fragmented-MP4 file. Apple's HLS-fMP4 assets use a
// single byte-range-addressed file for the whole track (EXT-X-MAP + all #EXTINF
// segments reference the same filename with different #EXT-X-BYTERANGE), so
// downloading that one file whole gives a complete, valid fragmented MP4 - no
// need to stitch byte ranges ourselves.
func (c *Client) MediaFileURL(manifestURL string) (string, error) {
	text, err := c.getText(manifestURL)
	if err != nil {
		return "", err
	}
	if ref := subManifestRe.FindString(text); ref != "" {
		return c.MediaFileURL(resolveRef(manifestURL, strings.TrimSpace(ref)))
	}
	if m := mediaFileRe.FindString(text); m != "" {
		return resolveRef(manifestURL, strings.TrimSpace(m)), nil
	}
	return "", fmt.Errorf("no media file reference found in manifest %s", manifestURL)
}

var mediaFileRe = regexp.MustCompile(`(?m)^[^#\n].*\.mp4.*$`)

// GetBytes downloads a URL fully into memory.
func (c *Client) GetBytes(url string) ([]byte, error) {
	resp, err := c.HTTP.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GET %s -> HTTP %d", url, resp.StatusCode)
	}
	return b, nil
}

// APIGet performs an authenticated GET against the Apple Music REST API and
// returns the raw response body.
//
// This exists because the webOS 2.x in-app browser cannot reach Apple at all:
// its TLS stack is too old to complete a handshake with Apple's servers (plain
// https to other hosts works; Apple specifically fails). So the Mojo app can't
// call the API itself and instead proxies every catalog/library request through
// this binary, which brings its own modern TLS.
//
// pathOrURL may be a full https:// URL or an API path such as
// "/v1/me/library/songs?limit=100". The body is returned even on a non-2xx
// status, so the caller can surface Apple's own JSON error to the user.
func (c *Client) APIGet(pathOrURL string) ([]byte, int, error) {
	url := pathOrURL
	if !strings.HasPrefix(url, "http") {
		if !strings.HasPrefix(url, "/") {
			url = "/" + url
		}
		url = "https://api.music.apple.com" + url
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, 0, err
	}
	c.auth(req)
	// auth() sends the user token as "x-apple-music-user-token", which is what the
	// play.music.apple.com webPlayback endpoint wants. api.music.apple.com's
	// personalized /v1/me/* endpoints want the same value under "Music-User-Token"
	// instead, and reject the request with 403 "Authentication required" without it
	// (verified on-device). Send both so either endpoint family is satisfied.
	req.Header.Set("Music-User-Token", c.UserToken)

	// The jail this runs in intermittently stalls the TLS handshake to
	// api.music.apple.com (seen on-device as "net/http: TLS handshake
	// timeout" on maybe 1 in 3 calls, always recovering on the next
	// attempt) - a network/entropy quirk of the constrained jail, not
	// anything wrong with the request. A GET has no body to worry about
	// re-sending, so retry transport-level errors a couple of times
	// before giving up; HTTP-status errors (4xx/5xx, a real response
	// from Apple) are not retried and are returned as-is.
	var resp *http.Response
	for attempt := 0; ; attempt++ {
		resp, err = c.HTTP.Do(req)
		if err == nil {
			break
		}
		if attempt >= 2 {
			return nil, 0, err
		}
		time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return stripAstral(b), resp.StatusCode, nil
}

// stripAstral removes Unicode codepoints outside the Basic Multilingual Plane
// (emoji and friends) from a JSON response body.
//
// Why: this Mojo app's playback path is unaffected (jukie-drm talks straight to
// the gst pipeline), but its catalog/library browsing is proxied over this
// device's Luna service bus (see cmd/jukie-drm's -api mode) because the
// on-device WebKit can't reach Apple directly. That Luna bus implementation is
// ~15 years old, predating routine astral-plane text (characters needing a
// UTF-16 surrogate pair), and reproducibly swallows the reply outright - no
// onSuccess, no onFailure, just permanent silence - for exactly the responses
// that contain one, while every structurally-identical request without one
// succeeds. That silence is what made the library sync appear to "hang forever"
// on the playlists step: one playlist here is named "90s <emoji>".
//
// There are TWO encodings to handle, and missing the second is what made an
// earlier version of this function look correct while fixing nothing:
//
//  1. Raw UTF-8 - the 4-byte encoding decodes to a rune > 0xFFFF.
//  2. JSON-escaped - Apple actually sends `🥰`, i.e. the surrogate
//     pair spelled out as plain ASCII escape sequences. Those bytes contain no
//     rune above 0xFFFF at all, so a decode-and-compare pass sees nothing to do
//     and passes them through untouched; JSON.parse on the far side then
//     reassembles the real surrogate pair and the reply dies anyway.
//
// Both forms are stripped here. JSON syntax itself is pure ASCII and whole
// escape units are removed, so this can only ever affect string content - it
// can never corrupt the document structure.
func stripAstral(b []byte) []byte {
	b = stripEscapedSurrogates(b)

	hasAstral := false
	for _, r := range string(b) {
		if r > 0xFFFF {
			hasAstral = true
			break
		}
	}
	if !hasAstral {
		return b
	}
	var out []rune
	for _, r := range string(b) {
		if r <= 0xFFFF {
			out = append(out, r)
		}
	}
	return []byte(string(out))
}

// stripEscapedSurrogates drops any `\uXXXX` escape whose value lands in the
// UTF-16 surrogate range (0xD800-0xDFFF). A literal `\\` is copied through as a
// unit so that an escaped backslash immediately followed by a `u` is not
// mistaken for the start of an escape sequence.
func stripEscapedSurrogates(b []byte) []byte {
	out := make([]byte, 0, len(b))
	for i := 0; i < len(b); {
		if b[i] == '\\' {
			if i+1 < len(b) && b[i+1] == '\\' {
				out = append(out, b[i], b[i+1])
				i += 2
				continue
			}
			if i+5 < len(b) && b[i+1] == 'u' {
				if v, err := strconv.ParseUint(string(b[i+2:i+6]), 16, 32); err == nil && v >= 0xD800 && v <= 0xDFFF {
					i += 6
					continue
				}
			}
		}
		out = append(out, b[i])
		i++
	}
	return out
}

func (c *Client) getText(url string) (string, error) {
	resp, err := c.HTTP.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("GET %s -> HTTP %d", url, resp.StatusCode)
	}
	return string(b), nil
}

func resolveRef(base, ref string) string {
	if strings.HasPrefix(ref, "http") {
		return ref
	}
	if i := strings.LastIndex(base, "/"); i >= 0 {
		return base[:i+1] + ref
	}
	return ref
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "..."
	}
	return string(b)
}
