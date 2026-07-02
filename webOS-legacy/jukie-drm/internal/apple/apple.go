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
	return &Client{WebToken: webToken, UserToken: userToken, HTTP: &http.Client{Timeout: 30 * time.Second}}
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
