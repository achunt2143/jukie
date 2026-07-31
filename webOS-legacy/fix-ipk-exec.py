#!/usr/bin/env python3
"""Set the POSIX executable bit on files inside an already-built webOS .ipk.

Why this exists
---------------
`palm-package` copies each file's mode straight off the build machine's
filesystem. On Windows/NTFS there is no POSIX executable bit to copy, so every
file lands in the package as 0644 - including `jukie-drm`, which the Luna
service exec()s. On-device that surfaces as the service dying with
"execvp(): Permission denied" on every playback and library call.

Chmod-ing on the device after each install works but has to be remembered every
single time (and silently un-fixes itself on the next reinstall). The `.ipk` is
just an `ar` archive wrapping `data.tar.gz`, and a tar DOES carry a mode per
entry - so the honest fix is to stamp the bit into the package itself at build
time, which is what this does. After running this, the installed file is already
executable and nothing has to be repaired on-device.

Usage:
    python fix-ipk-exec.py <package.ipk> <filename> [<filename> ...]

<filename> is matched against each tar entry's basename, e.g. "jukie-drm".
"""

import io
import os
import sys
import tarfile

AR_MAGIC = b"!<arch>\n"


def read_ar(path):
    """Parse an ar archive into [name, raw_60_byte_header, body] triples."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != AR_MAGIC:
        raise SystemExit(f"{path}: not an ar archive (bad magic)")
    members, i = [], 8
    while i < len(data):
        header = data[i:i + 60]
        if len(header) < 60:
            break
        name = header[0:16].decode("ascii").strip()
        size = int(header[48:58].decode("ascii").strip())
        i += 60
        members.append([name, header, data[i:i + size]])
        i += size
        if i % 2 == 1:  # ar pads odd-sized members to an even boundary
            i += 1
    return members


def write_ar(path, members):
    with open(path, "wb") as f:
        f.write(AR_MAGIC)
        for name, header, body in members:
            header = bytearray(header)
            header[48:58] = b"%-10d" % len(body)  # size may have changed
            f.write(bytes(header))
            f.write(body)
            if len(body) % 2 == 1:
                f.write(b"\n")


def set_modes(targz, targets, mode=0o755):
    """Rewrite a .tar.gz, forcing `mode` on entries whose basename is in targets.

    format=tarfile.GNU_FORMAT is required on the OUTPUT archive - Python 3's tarfile
    defaults to PAX_FORMAT, which emits 'x' (extended header) entries. Confirmed on a
    real device (2026-07-31): webOS's ancient ipkg/tar parser doesn't understand PAX at
    all ("Unknown typeflag: 0x78: Illegal seek"), and worse, that one bad entry desyncs
    its read position for the REST of the archive - everything packed after the first
    PAX header silently fails to install (observed as "0 services detected for package
    com.achunt.jukie": the app files, packed first, installed fine; the service files,
    packed later, never landed at all - no error surfaced anywhere in palm-install's own
    output, only found by re-running ipkg install by hand and reading its stderr). GNU
    format has been around since long before PAX and needs no extended headers for
    filenames/sizes this small, so it round-trips through ipkg's parser cleanly.
    """
    out = io.BytesIO()
    changed = []
    with tarfile.open(fileobj=io.BytesIO(targz), mode="r:gz") as tin, \
         tarfile.open(fileobj=out, mode="w:gz", format=tarfile.GNU_FORMAT) as tout:
        for member in tin.getmembers():
            payload = tin.extractfile(member) if member.isfile() else None
            if member.isfile() and os.path.basename(member.name) in targets:
                member.mode = mode
                changed.append(member.name)
            tout.addfile(member, payload)
    return out.getvalue(), changed


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    ipk, targets = sys.argv[1], set(sys.argv[2:])

    members = read_ar(ipk)
    all_changed = []
    for entry in members:
        if entry[0].rstrip("/") == "data.tar.gz":
            entry[2], all_changed = set_modes(entry[2], targets)

    if not all_changed:
        raise SystemExit(f"ERROR: none of {sorted(targets)} found in {ipk} - nothing changed")

    write_ar(ipk, members)
    for name in all_changed:
        print(f"  chmod 0755  {name}")
    print(f"{ipk}: set executable bit on {len(all_changed)} file(s)")


if __name__ == "__main__":
    main()
