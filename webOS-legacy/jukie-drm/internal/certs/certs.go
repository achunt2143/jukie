// Package certs embeds a CA bundle and installs it as the process-wide TLS root
// store.
//
// Why this exists: webOS devices have no CA bundle at any of the paths Go's
// crypto/x509 probes, so every HTTPS request fails with "x509: certificate
// signed by unknown authority" unless roots are supplied. Until now that was
// worked around by setting SSL_CERT_FILE to a manually-pushed cacert.pem, which
// only works when a human sets it up by hand - no good for a packaged app whose
// binary is spawned by the Luna service.
//
// cacert.pem is Mozilla's CA list as published by the curl project
// (https://curl.se/ca/cacert.pem) - the standard source for exactly this
// bootstrapping problem. Refresh it periodically; an expired bundle shows up as
// certificate-verification failures.
package certs

import (
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"errors"
	"net/http"
)

//go:embed cacert.pem
var caPEM []byte

// Install points the default HTTP transport's TLS config at the embedded roots.
// Call it once, early in main(). Clients built with &http.Client{} (which is what
// apple.New does) use http.DefaultTransport, so this covers them too.
//
// Deliberately an explicit call rather than an init() side effect: silently
// rewriting global TLS config on import is the kind of magic that's miserable to
// debug later.
func Install() error {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return errors.New("certs: embedded CA bundle contained no usable certificates")
	}
	tr, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return errors.New("certs: http.DefaultTransport is not an *http.Transport")
	}
	if tr.TLSClientConfig == nil {
		tr.TLSClientConfig = &tls.Config{}
	}
	tr.TLSClientConfig.RootCAs = pool
	return nil
}

// Pool returns the embedded roots, for callers that build their own transport.
func Pool() (*x509.CertPool, error) {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("certs: embedded CA bundle contained no usable certificates")
	}
	return pool, nil
}
