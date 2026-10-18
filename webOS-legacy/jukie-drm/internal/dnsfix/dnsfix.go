// Package dnsfix gives Go's pure resolver somewhere to send DNS queries on systems that
// have no /etc/resolv.conf. Android is one: a static linux binary run there otherwise falls
// back to 127.0.0.1:53 / [::1]:53, where nothing listens, so every hostname lookup fails
// even though the network is fine. webOS devices have a resolv.conf, so Install is a no-op
// there and their behavior is unchanged.
package dnsfix

import (
	"context"
	"net"
	"os"
	"time"
)

// Public resolvers tried in order when the system has none configured.
var fallback = []string{"1.1.1.1:53", "8.8.8.8:53"}

// Install points net.DefaultResolver at the fallback servers if /etc/resolv.conf is
// missing. Returns true if it changed anything. Call once, early in main(), before any
// network use (http.DefaultTransport dials through net.DefaultResolver).
func Install() bool {
	if _, err := os.Stat("/etc/resolv.conf"); err == nil {
		return false
	}
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 5 * time.Second}
			var lastErr error
			for _, addr := range fallback {
				c, err := d.DialContext(ctx, network, addr)
				if err == nil {
					return c, nil
				}
				lastErr = err
			}
			return nil, lastErr
		},
	}
	return true
}
