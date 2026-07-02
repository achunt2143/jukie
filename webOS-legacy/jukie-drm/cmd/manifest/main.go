// Milestone 1: fetch a track's Apple Music web-playback HLS manifest and confirm a
// Widevine key is present (the make-or-break premise for the whole DRM plan).
//
// This is deliberately a debuggable probe: it prints the raw webPlayback response and
// the manifest's key lines so we can see exactly what Apple returns and iterate.
//
// Runs fine on the PC during dev:  go run ./cmd/manifest <songId>
// (defaults to a known song id if none given). The same code cross-compiles for the
// device later. Credentials come from jukie-drm/secrets.local.json (git-ignored).
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	webPlaybackURL = "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/webPlayback"
	widevineUUID   = "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" // EME Widevine system id
)

type secrets struct {
	DeveloperToken    string `json:"developerToken"`
	WebDeveloperToken string `json:"webDeveloperToken"` // first-party AMPWebPlay token; amp-api needs this
	MusicUserToken    string `json:"musicUserToken"`
	Storefront        string `json:"storefront"`
}

// ampToken returns the token amp-api accepts (first-party web token), falling back
// to the custom developer token if no web token is configured.
func (s secrets) ampToken() string {
	if s.WebDeveloperToken != "" {
		return s.WebDeveloperToken
	}
	return s.DeveloperToken
}

func loadSecrets() (secrets, error) {
	var s secrets
	b, err := os.ReadFile("secrets.local.json")
	if err != nil {
		return s, fmt.Errorf("read secrets.local.json (run from jukie-drm/): %w", err)
	}
	return s, json.Unmarshal(b, &s)
}

func main() {
	songID := "1893817936" // "Good Days" - Lenka, from the app logs
	if len(os.Args) > 1 {
		songID = os.Args[1]
	}

	s, err := loadSecrets()
	if err != nil {
		fmt.Println("FAIL:", err)
		os.Exit(1)
	}
	if s.Storefront == "" {
		s.Storefront = "us"
	}

	// The Widevine path: amp-api streaming asset (enhancedHls), which carries the
	// multi-DRM session keys. This is what we actually need.
	probeEnhancedHls(s, songID)

	fmt.Printf("\n=== (reference) webPlayback for song %s ===\n", songID)

	body, _ := json.Marshal(map[string]string{"salableAdamId": songID, "language": "en-US"})
	req, _ := http.NewRequest("POST", webPlaybackURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://music.apple.com")
	req.Header.Set("Authorization", "Bearer "+s.DeveloperToken)
	// Tools disagree on the exact header name; send both spellings to be safe.
	req.Header.Set("Music-User-Token", s.MusicUserToken)
	req.Header.Set("media-user-token", s.MusicUserToken)

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		fmt.Println("FAIL transport:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	fmt.Printf("HTTP %d\n", resp.StatusCode)

	// Pretty-print whatever came back so we can see the shape.
	var pretty bytes.Buffer
	if json.Indent(&pretty, raw, "", "  ") == nil {
		printTruncated(pretty.String(), 4000)
	} else {
		printTruncated(string(raw), 2000)
	}

	// Try to pull the HLS master URL out of the response and inspect it.
	m3u8URL := findM3U8(raw)
	if m3u8URL == "" {
		fmt.Println("\nNo .m3u8 URL found in response - inspect the JSON above to adjust the request.")
		return
	}
	fmt.Printf("\n=== HLS master: %s\n", m3u8URL)
	inspectManifest(m3u8URL)
}

func ampGet(s secrets, path string) (int, []byte) {
	req, _ := http.NewRequest("GET", "https://amp-api.music.apple.com"+path, nil)
	req.Header.Set("Authorization", "Bearer "+s.ampToken())
	req.Header.Set("media-user-token", s.MusicUserToken)
	req.Header.Set("Origin", "https://music.apple.com")
	req.Header.Set("Referer", "https://music.apple.com/")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		fmt.Println("FAIL transport:", err)
		return 0, nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

// probeEnhancedHls hits amp-api for the streaming asset that carries Widevine.
func probeEnhancedHls(s secrets, songID string) {
	// First isolate: does amp-api accept our token at all (basic song lookup)?
	basicPath := fmt.Sprintf("/v1/catalog/%s/songs/%s", s.Storefront, songID)
	if code, body := ampGet(s, basicPath); code != 200 {
		fmt.Printf("amp-api basic lookup -> HTTP %d (token not accepted by amp-api):\n", code)
		printTruncated(string(body), 1200)
		return
	} else {
		fmt.Println("amp-api basic lookup -> HTTP 200 (token OK; trying streaming extension)")
	}

	path := fmt.Sprintf("/v1/catalog/%s/songs/%s?extend=extendedAssetUrls", s.Storefront, songID)
	fmt.Printf("=== amp-api extendedAssetUrls: %s\n", path)
	code, raw := ampGet(s, path)
	fmt.Printf("HTTP %d\n", code)
	if code != 200 {
		printTruncated(string(raw), 1500)
		return
	}

	// Dump the full extendedAssetUrls object so we can see EVERY asset URL Apple
	// offers (the Widevine/SAMPLE-AES-CTR variant may be a different field/URL).
	var doc struct {
		Data []struct {
			Attributes struct {
				ExtendedAssetUrls map[string]any `json:"extendedAssetUrls"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &doc) == nil && len(doc.Data) > 0 {
		if b, err := json.MarshalIndent(doc.Data[0].Attributes.ExtendedAssetUrls, "", "  "); err == nil {
			fmt.Println("--- extendedAssetUrls ---")
			fmt.Println(string(b))
		}
	}
	// Pull every *.m3u8 in the asset object; enhancedHls is the one we want.
	urls := m3u8Re.FindAllString(string(raw), -1)
	seen := map[string]bool{}
	var hls string
	for _, u := range urls {
		if seen[u] {
			continue
		}
		seen[u] = true
		fmt.Println("  asset m3u8:", u)
		if strings.Contains(u, "enhanced") || hls == "" {
			hls = u
		}
	}
	if hls == "" {
		fmt.Println("  no enhancedHls found - dumping extendedAssetUrls:")
		printExtended(raw)
		return
	}
	fmt.Printf("\n=== enhancedHls master: %s\n", hls)
	inspectManifest(hls)
}

func printExtended(raw []byte) {
	var doc map[string]any
	if json.Unmarshal(raw, &doc) == nil {
		if b, err := json.MarshalIndent(doc, "", "  "); err == nil {
			printTruncated(string(b), 3000)
			return
		}
	}
	printTruncated(string(raw), 2000)
}

var m3u8Re = regexp.MustCompile(`https?://[^"\\ ]+?\.m3u8[^"\\ ]*`)

func findM3U8(raw []byte) string {
	if m := m3u8Re.Find(raw); m != nil {
		return string(m)
	}
	return ""
}

var psshRe = regexp.MustCompile(`URI="data:[^;]*;base64,([^"]+)"`)

func inspectManifest(url string) {
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Get(url)
	if err != nil {
		fmt.Println("FAIL fetch manifest:", err)
		return
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	text := string(b)

	fmt.Println("--- key/session lines ---")
	widevine := false
	var firstVariant string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#EXT-X-KEY") || strings.HasPrefix(line, "#EXT-X-SESSION-KEY") {
			fmt.Println(line)
			if strings.Contains(line, widevineUUID) || strings.Contains(strings.ToLower(line), "widevine") {
				widevine = true
				if m := psshRe.FindStringSubmatch(line); m != nil {
					fmt.Printf("    -> Widevine PSSH (base64): %s\n", m[1])
				}
			}
		} else if firstVariant == "" && line != "" && !strings.HasPrefix(line, "#") &&
			strings.Contains(line, ".m3u8") {
			firstVariant = resolveRef(url, line)
		}
	}

	if widevine {
		fmt.Println("\nPASS: Widevine key present in the Apple Music manifest. Milestone 1 ✓")
		return
	}
	if firstVariant != "" {
		fmt.Printf("\nNo keys in this playlist - following variant: %s\n", firstVariant)
		inspectManifest(firstVariant)
		return
	}
	// This is a media playlist (no sub-playlist). The Widevine PSSH for Apple's
	// HLS-fMP4 is carried in the init segment's moov, not the m3u8 text - go look.
	if mapURI, off, length := parseMap(text); mapURI != "" {
		scanInitForPSSH(resolveRef(url, mapURI), off, length)
		return
	}
	fmt.Println("\nNo Widevine KEYFORMAT and no EXT-X-MAP init segment found. Head of manifest:")
	printTruncated(text, 1200)
}

var mapRe = regexp.MustCompile(`#EXT-X-MAP:URI="([^"]+)"(?:,BYTERANGE="(\d+)@(\d+)")?`)

func parseMap(text string) (uri string, offset, length int64) {
	m := mapRe.FindStringSubmatch(text)
	if m == nil {
		return "", 0, 0
	}
	uri = m[1]
	if m[2] != "" {
		fmt.Sscan(m[2], &length)
		fmt.Sscan(m[3], &offset)
	}
	return uri, offset, length
}

// Widevine EME system id, as 16 raw bytes.
var widevineSystemID = []byte{0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed}

func scanInitForPSSH(url string, offset, length int64) {
	fmt.Printf("\n=== fetching init segment for PSSH: %s (bytes %d..%d)\n", url, offset, offset+length-1)
	req, _ := http.NewRequest("GET", url, nil)
	if length > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, offset+length-1))
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		fmt.Println("FAIL fetch init:", err)
		return
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	fmt.Printf("init segment: %d bytes (HTTP %d)\n", len(b), resp.StatusCode)

	found := false
	// Walk the byte stream looking for 'pssh' box type. Each MP4 box is
	// [4 bytes size][4 bytes type]; pssh payload = version/flags(4) + systemID(16).
	for i := 0; i+8 <= len(b); i++ {
		if string(b[i+4:i+8]) != "pssh" {
			continue
		}
		boxStart := i // size field is the 4 bytes before 'pssh'
		size := int(b[boxStart])<<24 | int(b[boxStart+1])<<16 | int(b[boxStart+2])<<8 | int(b[boxStart+3])
		sidOff := i + 8 + 4 // after 'pssh' + version/flags
		if sidOff+16 > len(b) {
			continue
		}
		sysID := b[sidOff : sidOff+16]
		name := "unknown"
		switch {
		case bytesEqual(sysID, widevineSystemID):
			name = "WIDEVINE"
		case sysID[0] == 0x94 && sysID[1] == 0xce: // 9a04f079... PlayReady
			name = "PlayReady?"
		case sysID[0] == 0x29 && sysID[1] == 0x70: // Apple FairPlay streaming
			name = "FairPlay?"
		}
		end := boxStart + size
		if size <= 0 || end > len(b) {
			end = len(b)
		}
		fmt.Printf("  pssh box: systemID=%x (%s), size=%d\n", sysID, name, size)
		if name == "WIDEVINE" {
			found = true
			fmt.Printf("    -> Widevine PSSH (base64): %s\n", base64.StdEncoding.EncodeToString(b[boxStart:end]))
		}
	}
	if found {
		fmt.Println("\nPASS: Widevine PSSH present in the init segment. Milestone 1 ✓")
	} else {
		fmt.Println("\nNo Widevine pssh in this init segment. (May need a longer range, or this")
		fmt.Println("asset is FairPlay-only for web; will inspect the full init / other assets next.)")
		fmt.Printf("init hex head: %x\n", b[:min(64, len(b))])
	}
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// resolveRef turns a possibly-relative playlist URI into an absolute URL.
func resolveRef(base, ref string) string {
	if strings.HasPrefix(ref, "http") {
		return ref
	}
	if i := strings.LastIndex(base, "/"); i >= 0 {
		return base[:i+1] + ref
	}
	return ref
}

func printTruncated(s string, n int) {
	if len(s) > n {
		s = s[:n] + "\n...[truncated]"
	}
	fmt.Println(s)
}
