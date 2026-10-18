#!/usr/bin/env python3
"""Fail if a built webOS .ipk contains local-only secret files.

`*.local.*` is this project's convention for files holding real credentials
(e.g. enyo/source/dev-token.local.js). They are git-ignored, but palm-package
knows nothing about .gitignore or build-ignore, so they get packaged unless
something stops them - and an .ipk is meant to be shared. This inspects the
finished package and exits non-zero if any such file is inside.

The one allowed exception is the service's secrets.local.json, which ships as a
blank placeholder the app fills in on-device; it passes only if every
token-looking field is empty.

Usage:
    python check-ipk-secrets.py [--public] <package.ipk>

--public is for a package that will be PUBLISHED (a release / upload / attachment). It also
fails on any *.wvd file: device.wvd is the owner's private Widevine device credential, which the
service dir needs for a personal build but which must never be shared (leaked .wvd files get
revoked, and the credential is the owner's own). make-release-ipk.ps1 builds a package that
passes this; a normal deploy build (with device.wvd) deliberately does not.

Exit: 0 clean, 1 secrets found, 2 package unreadable. Never prints file contents.
"""

import fnmatch
import io
import json
import posixpath
import sys
import tarfile

AR_MAGIC = b"!<arch>\n"
PLACEHOLDER = "secrets.local.json"


def data_tar(ipk_bytes):
    if ipk_bytes[:8] != AR_MAGIC:
        raise ValueError("not an ar archive")
    pos = 8
    while pos + 60 <= len(ipk_bytes):
        hdr = ipk_bytes[pos:pos + 60]
        name = hdr[:16].decode().strip().rstrip("/")
        size = int(hdr[48:58].decode().strip())
        body = ipk_bytes[pos + 60:pos + 60 + size]
        if name.startswith("data.tar"):
            return tarfile.open(fileobj=io.BytesIO(body), mode="r:*")
        pos += 60 + size + (size % 2)
    raise ValueError("no data.tar.* member")


def placeholder_problem(raw):
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception:
        return "is not valid JSON, so it can't be verified blank"
    filled = [k for k, v in obj.items()
              if not k.startswith("_") and "token" in k.lower() and isinstance(v, str) and v.strip()]
    if filled:
        return "has non-empty credential field(s): " + ", ".join(filled)
    return None


def main():
    args = sys.argv[1:]
    public = "--public" in args
    args = [a for a in args if a != "--public"]
    if len(args) != 1:
        print(__doc__)
        return 2
    path = args[0]
    try:
        tar = data_tar(open(path, "rb").read())
    except Exception as e:
        print("check-ipk-secrets: cannot read %s: %s" % (path, e))
        return 2

    bad = []
    for m in tar.getmembers():
        base = posixpath.basename(m.name)
        if not m.isfile():
            continue
        if public and fnmatch.fnmatchcase(base.lower(), "*.wvd"):
            bad.append((m.name, "is a Widevine device credential and must not be published"))
            continue
        if not fnmatch.fnmatchcase(base, "*.local.*"):
            continue
        if base == PLACEHOLDER:
            why = placeholder_problem(tar.extractfile(m).read())
            if why:
                bad.append((m.name, why))
        else:
            bad.append((m.name, "is a local-only file and must not be packaged"))

    if bad:
        print("check-ipk-secrets: FAIL - %s contains secrets:" % path)
        for name, why in bad:
            print("  %s  %s" % (name, why))
        return 1
    print("check-ipk-secrets: OK - no local-only secret files in %s%s" % (path, " (public: no .wvd either)" if public else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
