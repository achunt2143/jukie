// jukie-auth: Apple Music credential helper for Jukie.
//
//	jukie-auth webtoken   -> fetch+cache the public web developer token (no login needed)
//
// With -json a single JSON line is printed on stdout; progress goes to stderr.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/achunt/jukie-drm/internal/appleauth"
)

func main() {
	cacheDir := flag.String("cachedir", appleauth.DefaultCacheDir, "writable cache dir")
	jsonOut := flag.Bool("json", false, "print one JSON result line on stdout")
	flag.Parse()
	appleauth.Logf = func(f string, a ...interface{}) { fmt.Fprintf(os.Stderr, "[auth] "+f+"\n", a...) }
	args := flag.Args()
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: jukie-auth [-json] webtoken")
		os.Exit(2)
	}

	switch args[0] {
	case "webtoken":
		runWebToken(*cacheDir, *jsonOut)
	default:
		fmt.Fprintln(os.Stderr, "unknown subcommand:", args[0])
		os.Exit(2)
	}
}

func runWebToken(cacheDir string, jsonOut bool) {
	t, err := appleauth.FetchWebToken(nil)
	if err != nil {
		emit(jsonOut, map[string]interface{}{"ok": false, "error": err.Error()})
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
	if cacheErr := appleauth.SaveCachedWebToken(cacheDir, t); cacheErr != nil {
		fmt.Fprintln(os.Stderr, "warn: could not cache token:", cacheErr)
	}
	if jsonOut {
		emit(true, map[string]interface{}{"ok": true, "token": t.Token, "expiry": t.Expiry})
		return
	}
	fmt.Println(t.Token)
	fmt.Fprintf(os.Stderr, "expires: %s\n", t.Expiry.Format("2006-01-02 15:04 MST"))
}

func emit(jsonOut bool, m map[string]interface{}) {
	if !jsonOut {
		return
	}
	b, _ := json.Marshal(m)
	fmt.Println(string(b))
}
