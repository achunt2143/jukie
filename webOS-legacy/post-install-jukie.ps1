# Post-install fixup for com.achunt.jukie: register the service on the LS2 bus.
#
# `palm-package`/`palm-install` have no maintainer-script mechanism - an .ipk built
# by palm-package.bat only ever contains debian-binary, control.tar.gz and
# data.tar.gz, with no postinst hook (confirmed by unpacking a built package). So
# bus registration has to run as its own step right after palm-install, every time:
# palm-install drops the service files but never registers them, and the
# registration files under /var/palm/ls2 are wiped on every reinstall. Without this
# the app fails with "Service does not exist".
#
# jukie-drm's executable bit: fix-ipk-exec.py stamps mode 0755 into the .ipk itself at
# build time (Windows/NTFS has no exec bit for palm-package to copy, so packages built on
# Windows would otherwise ship it as 0644) - but that stamp does NOT reliably survive
# palm-install on every device. Confirmed on a real Pre2 (2026-07-31): files landed 644
# regardless of the stamped .ipk, jukie-drm failed to spawn with "Permission denied", and
# playback broke - this device's palm-install evidently normalizes/discards the tar's
# stored mode rather than preserving it (this is the SAME thing the original
# deploy-jukie-mojo.ps1's on-device chmod already worked around, before this script
# existed - dropping that step when fix-ipk-exec.py was added was a mistake, not a real
# fix). TouchPad's palm-install lands files executable on its own either way and its jail
# mount rejects an explicit chmod outright - hence chmod both here unconditionally and
# swallow errors (2>/dev/null), so it's a real fix on Pre2-class devices and a harmless
# no-op everywhere else.
#
# Usage:  powershell -ExecutionPolicy Bypass -File post-install-jukie.ps1

$ErrorActionPreference = 'Stop'

$deviceScript = @'

SVC=com.achunt.jukie.service
DIR=/media/cryptofs/apps/usr/palm/services/$SVC

chmod +x "$DIR"/jukie-drm-webos2 "$DIR"/jukie-drm-webos3 2>/dev/null
ls -l "$DIR"/jukie-drm-webos* 2>/dev/null || echo "WARN: no jukie-drm-webos2/webos3 binary found at $DIR"

# Clear EVERY prior registration for this bus name before writing a fresh one.
# LS2 refuses to start a service whose name is declared more than once:
#   "Attempted to register for a service name that already exists"
# and the service then dies at startup, so every call just hangs forever with no
# error anywhere - playback and library sync both silently stop working.
# Two ways duplicates have actually appeared here:
#   - the installer registers the service itself as "<name>.service", alongside
#     the "<name>" file this script writes;
#   - an early version of this script ran with an empty shell variable and left
#     stray role files literally called ".json".
# Removing all of them first makes this idempotent no matter what came before.
rm -f /var/palm/ls2/services/pub/$SVC /var/palm/ls2/services/pub/$SVC.service
rm -f /var/palm/ls2/services/prv/$SVC /var/palm/ls2/services/prv/$SVC.service
rm -f /var/palm/ls2/roles/pub/$SVC.json /var/palm/ls2/roles/pub/.json
rm -f /var/palm/ls2/roles/prv/$SVC.json /var/palm/ls2/roles/prv/.json

cat > /var/palm/ls2/services/pub/$SVC <<EOF
[D-BUS Service]
Name=$SVC
Exec=/usr/bin/run-js-service -n $DIR
EOF
cp /var/palm/ls2/services/pub/$SVC /var/palm/ls2/services/prv/$SVC

cat > /var/palm/ls2/roles/pub/$SVC.json <<'JSON'
{ "role": { "exeName":"js", "type":"regular", "allowedNames":["com.achunt.jukie.service"] },
  "permissions": [ { "service":"com.achunt.jukie.service", "inbound":["*"], "outbound":["*"] } ] }
JSON
sed 's/"outbound":\["\*"\]/"outbound":[]/' /var/palm/ls2/roles/pub/$SVC.json > /var/palm/ls2/roles/prv/$SVC.json

PID=`ps ax | grep $SVC.js | grep -v grep | awk '{print $1}'`
[ -n "$PID" ] && kill -9 $PID && echo "killed stale service pid $PID" || echo "no stale service instance"

ls-control scan-services >/dev/null 2>&1
echo "registered $SVC on the bus"
echo "---EXIT---"; exit
'@
$deviceScript | & novacom.exe -t open tty://
