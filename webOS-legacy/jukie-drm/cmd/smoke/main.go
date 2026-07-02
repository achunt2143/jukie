// Milestone 0 smoke test for the on-device DRM helper.
//
// Goal: prove a CGO-free static Go binary actually RUNS inside the webOS service
// jail on the TouchPad's ancient kernel (2.6.35), and that the three things the
// real helper will depend on work there:
//   1. the Go runtime starts at all (kernel >= 2.6.32 requirement),
//   2. crypto/rand can read entropy (/dev/urandom is present in the jail),
//   3. outbound HTTPS/TLS works to the Apple Music API host.
//
// It prints a clear PASS/FAIL line for each so we can read the result over novacom.
//
// Build: jukie-drm/build.ps1 smoke   (GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0)
package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"syscall"
	"time"
)

func unameRelease() string {
	var u syscall.Utsname
	if err := syscall.Uname(&u); err != nil {
		return "uname failed: " + err.Error()
	}
	b := make([]byte, 0, len(u.Release))
	for _, c := range u.Release {
		if c == 0 {
			break
		}
		b = append(b, byte(c))
	}
	return string(b)
}

func main() {
	fmt.Println("=== jukie-drm smoke test ===")
	fmt.Printf("go runtime: %s %s/%s\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
	fmt.Printf("kernel:     %s\n", unameRelease())
	fmt.Printf("args:       %v\n", os.Args)

	// 1. runtime is obviously up if we got here.
	fmt.Println("PASS  runtime: binary started and runs on this kernel")

	// 2. entropy / crypto/rand (real helper needs this for RSA/AES/TLS).
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		fmt.Printf("FAIL  crypto/rand: %v\n", err)
	} else {
		fmt.Printf("PASS  crypto/rand: %x\n", buf)
	}

	// 3. outbound HTTPS to the Apple Music API host. A 401/404 is fine - it proves
	//    DNS + TLS handshake + HTTP round-trip all work. We only fail on transport
	//    errors (no network, TLS/cert failure, etc.).
	client := &http.Client{Timeout: 20 * time.Second}
	const url = "https://api.music.apple.com/v1/catalog/us"
	resp, err := client.Get(url)
	if err != nil {
		fmt.Printf("FAIL  https: %v\n", err)
		fmt.Println("      (if this is an x509/cert error, the device just lacks a CA bundle -")
		fmt.Println("       the real helper will embed Mozilla roots; transport itself may be fine)")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
	fmt.Printf("PASS  https: %s -> HTTP %d (%d bytes read)\n", url, resp.StatusCode, len(body))
	fmt.Println("=== done ===")
}
