// jukie-drm: fetch an Apple Music track via the web Widevine flow, decrypt it, and
// write a plain playable .m4a. Designed to be spawned by the webOS Luna service.
//
//   jukie-drm [-o out.m4a] [-json] <songId> [universalLibraryId]
//
// With -json it prints exactly one JSON result line on stdout (all progress goes to
// stderr), so the node service can parse the outcome:
//   {"ok":true,"path":"/tmp/jukie-123.m4a","title":"...","artist":"...","durationMs":201335}
//
// secrets.local.json (webDeveloperToken, musicUserToken) and device.wvd are looked up
// in the working dir first, then next to the binary - so it runs both from the project
// during dev and from the service dir on-device.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/achunt/jukie-drm/internal/apple"
	"github.com/achunt/jukie-drm/internal/appleauth"
	widevine "github.com/iyear/gowidevine"
	"google.golang.org/protobuf/proto"
	wvpb "github.com/iyear/gowidevine/widevinepb"
)

type secrets struct {
	WebDeveloperToken string `json:"webDeveloperToken"`
	DeveloperToken    string `json:"developerToken"`
	MusicUserToken    string `json:"musicUserToken"`
}

type result struct {
	OK         bool   `json:"ok"`
	Path       string `json:"path,omitempty"`
	Title      string `json:"title,omitempty"`
	Artist     string `json:"artist,omitempty"`
	DurationMs int    `json:"durationMs,omitempty"`
	Error      string `json:"error,omitempty"`
}

// logf prints progress to stderr, keeping stdout clean for the -json result line.
func logf(format string, a ...any) { fmt.Fprintf(os.Stderr, format+"\n", a...) }

func main() {
	out := flag.String("o", "", "output path for the decrypted .m4a (default: <title>.m4a)")
	jsonOut := flag.Bool("json", false, "print one JSON result line on stdout")
	flag.Parse()
	args := flag.Args()
	if len(args) < 1 {
		logf("usage: jukie-drm [-o out.m4a] [-json] <songId> [universalLibraryId]")
		os.Exit(2)
	}
	libraryID := ""
	if len(args) > 1 {
		libraryID = args[1]
	}

	r, err := run(args[0], libraryID, *out)
	if err != nil {
		r = result{OK: false, Error: err.Error()}
		logf("FAIL: %v", err)
	}
	if *jsonOut {
		b, _ := json.Marshal(r)
		fmt.Println(string(b))
	}
	if !r.OK {
		os.Exit(1)
	}
}

func run(songID, libraryID, outPath string) (result, error) {
	// Offline-first: if this track is cached with its metadata sidecar, return with NO
	// network call at all (instant replay; works with no connection).
	if outPath != "" {
		if r, ok := cachedResult(outPath); ok {
			logf("  cache hit (offline): %s", outPath)
			return r, nil
		}
	}

	s, err := loadSecrets()
	if err != nil {
		return result{}, err
	}
	// Auto-refresh the first-party web token: prefer the secrets value if still valid,
	// else the on-device cache, else fetch a fresh one from music.apple.com (no login)
	// and cache it. This is the ~35-day AMPWebPlay token that used to need manual updating.
	appleauth.Logf = logf
	webToken, err := appleauth.EnsureWebToken(appleauth.DefaultCacheDir, nil, s.WebDeveloperToken)
	if err != nil {
		return result{}, fmt.Errorf("no usable web token (secrets empty + auto-fetch failed): %w", err)
	}
	c := apple.New(webToken, s.MusicUserToken)

	logf("== webPlayback %s ==", songID)
	pb, err := c.WebPlayback(songID, libraryID)
	if err != nil {
		return result{}, err
	}
	logf("  %s — %s (%d ms)\n  manifest: %s", pb.Title, pb.Artist, pb.DurationMs, pb.ManifestURL)

	if outPath == "" {
		outPath = sanitizeFilename(pb.Title) + ".m4a"
	}
	// Cached file but no sidecar (e.g. older cache): skip download, write the sidecar now
	// so future replays are offline.
	if fi, statErr := os.Stat(outPath); statErr == nil && fi.Size() > 0 {
		logf("  cache hit: %s", outPath)
		r := result{OK: true, Path: outPath, Title: pb.Title, Artist: pb.Artist, DurationMs: pb.DurationMs}
		writeSidecar(outPath, r)
		return r, nil
	}

	initData, keyURI, err := c.WidevinePSSH(pb.ManifestURL)
	if err != nil {
		return result{}, err
	}
	pssh := buildWidevinePSSH(initData)
	logf("  key-id: %x", initData)

	certBytes, err := c.WidevineCert(pb.CertURL)
	if err != nil {
		return result{}, err
	}
	cert, err := parseAppleServiceCert(certBytes)
	if err != nil {
		return result{}, err
	}
	logf("  cert provider: %s", cert.GetProviderId())

	wvd, err := readDeviceWVD()
	if err != nil {
		return result{}, err
	}

	logf("== license exchange ==")
	keys, err := getKeys(wvd, cert, pssh, func(challenge []byte) ([]byte, error) {
		return c.AcquireLicense(pb, challenge, keyURI)
	})
	if err != nil {
		return result{}, err
	}
	logf("  got %d content key(s)", len(keys))

	logf("== download + decrypt ==")
	mediaURL, err := c.MediaFileURL(pb.ManifestURL)
	if err != nil {
		return result{}, err
	}
	encrypted, err := c.GetBytes(mediaURL)
	if err != nil {
		return result{}, err
	}
	logf("  downloaded %d bytes", len(encrypted))

	os.MkdirAll(filepath.Dir(outPath), 0777) // ensure the cache dir exists
	tmp := outPath + ".part" // write to .part then rename, so a partial file is never seen as complete
	f, err := os.Create(tmp)
	if err != nil {
		return result{}, err
	}
	if err := widevine.DecryptMP4Auto(bytes.NewReader(encrypted), keys, f); err != nil {
		f.Close()
		os.Remove(tmp)
		return result{}, fmt.Errorf("decrypt: %w", err)
	}
	f.Close()
	if err := os.Rename(tmp, outPath); err != nil {
		return result{}, err
	}
	logf("  decrypted -> %s", outPath)

	r := result{OK: true, Path: outPath, Title: pb.Title, Artist: pb.Artist, DurationMs: pb.DurationMs}
	writeSidecar(outPath, r)
	return r, nil
}

// cachedResult returns a result built purely from the cached file + its .json sidecar,
// with no network. Both must be present (the sidecar holds the duration/title we'd
// otherwise have to fetch).
func cachedResult(outPath string) (result, bool) {
	fi, err := os.Stat(outPath)
	if err != nil || fi.Size() == 0 {
		return result{}, false
	}
	b, err := os.ReadFile(outPath + ".json")
	if err != nil {
		return result{}, false
	}
	var r result
	if json.Unmarshal(b, &r) != nil || !r.OK {
		return result{}, false
	}
	r.Path = outPath
	return r, true
}

func writeSidecar(outPath string, r result) {
	if b, err := json.Marshal(r); err == nil {
		os.WriteFile(outPath+".json", b, 0666)
	}
}

// findFile looks for name in the working dir, then next to the executable.
func findFile(name string) (string, bool) {
	if _, err := os.Stat(name); err == nil {
		return name, true
	}
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), name)
		if _, err := os.Stat(p); err == nil {
			return p, true
		}
	}
	return "", false
}

func loadSecrets() (secrets, error) {
	var s secrets
	p, ok := findFile("secrets.local.json")
	if !ok {
		return s, fmt.Errorf("secrets.local.json not found (cwd or next to binary)")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal(b, &s)
}

func readDeviceWVD() ([]byte, error) {
	p, ok := findFile("device.wvd")
	if !ok {
		return nil, fmt.Errorf("device.wvd not found (cwd or next to binary)")
	}
	return os.ReadFile(p)
}

func sanitizeFilename(s string) string {
	if s == "" {
		return "track"
	}
	r := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return r.Replace(s)
}

// parseAppleServiceCert parses Apple's widevineCert response. gowidevine's
// ParseServiceCert expects a SignedMessage-wrapped certificate (typical license-server
// convention); Apple returns the bare SignedDrmCertificate, so we unwrap one level less.
func parseAppleServiceCert(raw []byte) (*wvpb.DrmCertificate, error) {
	signedCert := &wvpb.SignedDrmCertificate{}
	if err := proto.Unmarshal(raw, signedCert); err != nil {
		return nil, fmt.Errorf("unmarshal signed drm certificate: %w", err)
	}
	cert := &wvpb.DrmCertificate{}
	if err := proto.Unmarshal(signedCert.DrmCertificate, cert); err != nil {
		return nil, fmt.Errorf("unmarshal drm certificate: %w", err)
	}
	return cert, nil
}

// getKeys runs the gowidevine CDM: build challenge from PSSH (privacy mode w/ Apple's
// service cert), hand it to acquire() which POSTs to Apple, then parse the license.
func getKeys(wvd []byte, cert *wvpb.DrmCertificate, psshBytes []byte, acquire func([]byte) ([]byte, error)) ([]*widevine.Key, error) {
	device, err := widevine.NewDevice(widevine.FromWVD(bytes.NewReader(wvd)))
	if err != nil {
		return nil, fmt.Errorf("load device.wvd: %w", err)
	}
	cdm := widevine.NewCDM(device)

	pssh, err := widevine.NewPSSH(psshBytes)
	if err != nil {
		return nil, fmt.Errorf("parse pssh: %w", err)
	}

	challenge, parseLicense, err := cdm.GetLicenseChallenge(pssh, wvpb.LicenseType_AUTOMATIC, true, cert)
	if err != nil {
		return nil, fmt.Errorf("build challenge: %w", err)
	}
	licenseBytes, err := acquire(challenge)
	if err != nil {
		return nil, fmt.Errorf("acquire license: %w", err)
	}
	keys, err := parseLicense(licenseBytes)
	if err != nil {
		return nil, fmt.Errorf("parse license: %w", err)
	}
	return keys, nil
}

// Widevine EME system id.
var widevineSystemID = []byte{0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed}

// buildWidevinePSSH turns Apple's bare CENC key-id into a full Widevine 'pssh' box.
// If initData is already a pssh box, it's returned as-is.
func buildWidevinePSSH(initData []byte) []byte {
	if len(initData) >= 8 && string(initData[4:8]) == "pssh" {
		return initData
	}
	data := append([]byte{0x12, byte(len(initData))}, initData...) // WidevineCencHeader field 2 = key_id
	size := 4 + 4 + 4 + 16 + 4 + len(data)
	be32 := func(v int) []byte { return []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)} }
	box := make([]byte, 0, size)
	box = append(box, be32(size)...)
	box = append(box, 'p', 's', 's', 'h')
	box = append(box, 0, 0, 0, 0)
	box = append(box, widevineSystemID...)
	box = append(box, be32(len(data))...)
	box = append(box, data...)
	return box
}
