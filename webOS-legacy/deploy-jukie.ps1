# Deploy Jukie app + service to the connected TouchPad in one shot.
#
# Why this script exists (things `palm-install` does NOT do on a real device):
#   1. It drops the service files but does NOT register the JS service on the LS2
#      bus -> "Service does not exist". We must create the role/service files under
#      /var/palm/ls2 and `ls-control scan-services`.
#   2. Those LS2 files get wiped on every reinstall, so they must be re-created each time.
#   3. An already-running JS service keeps serving OLD code until it is killed; we kill
#      it so the next bus call reloads the new JukieAudioService.js.
#
# Usage:  powershell -ExecutionPolicy Bypass -File deploy-jukie.ps1
#         add  -NoPackage  to ONLY re-register + restart the bus (no code update).
#         NOTE: any change to app or service CODE needs a full run (repackage); the
#         jail won't accept direct file pushes, so -NoPackage reinstalls the stale ipk.

param([switch]$NoPackage)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$svc = 'com.achunt.jukie.service'

if (-not $NoPackage) {
    Remove-Item -Force 'com.achunt.jukie_*_all.ipk' -ErrorAction SilentlyContinue
    & palm-package.bat com.achunt.jukie com.achunt.jukie.service com.achunt.jukie.package
}
$ipk = Get-ChildItem 'com.achunt.jukie_*_all.ipk' | Select-Object -First 1
& palm-install.bat $ipk.Name

# Device-side: (re)register the service on the LS2 bus, rescan, and kill any stale
# running instance so the new code loads on the next call.
$deviceScript = @'

SVC=com.achunt.jukie.service
DIR=/media/cryptofs/apps/usr/palm/services/$SVC

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

# palm-install already lands files as rwxrwxrwx, and the cryptofs jail mount rejects
# chmod anyway, so we just confirm the helper is present (don't fail if chmod is a no-op).
ls -l /media/cryptofs/apps/usr/palm/services/$SVC/jukie-drm 2>/dev/null || echo "WARN: jukie-drm not deployed"

# IMPORTANT: kill any stale instance BEFORE scanning. If we scan first, the hub
# registers the live pid, then we kill it, and every later call routes to a dead
# process and hangs. Kill -> then scan so the hub has a clean slate.
PID=`ps ax | grep $SVC.js | grep -v grep | awk '{print $1}'`
[ -n "$PID" ] && kill -9 $PID && echo "killed stale pid $PID" || echo "no stale instance"
# also reap any orphaned playback processes from a previous run
for p in `ps ax | grep gst-launch | grep -v grep | awk '{print $1}'`; do kill -9 $p; done

ls-control scan-services >/dev/null 2>&1
echo "registered $SVC on the bus (will start fresh on first call)"
echo "---EXIT---"; exit
'@
$deviceScript | & novacom.exe -t open tty://

Write-Host "`nDone. Launch with: palm-launch com.achunt.jukie" -ForegroundColor Green
