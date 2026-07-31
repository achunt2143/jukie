/*
 * Jukie audio playback service.
 *
 * webOS's HTML5 <audio> (and the com.palm.mediad MediaPlayer it routes through)
 * cannot play our audio on this device: its playbin-based pipeline needs the
 * GStreamer "audioresample" element, which is absent. A hand-built gst-launch
 * pipeline (decodebin -> pulsesink) plays the same audio fine. This service runs
 * that pipeline and exposes play/pause/resume/stop/getStatus over the Luna bus.
 *
 * IMPORTANT - why we download first instead of streaming with souphttpsrc:
 * Apple preview URLs are HTTPS, and this service runs inside a webOS jail whose
 * /dev has urandom but NO /dev/random. gst's souphttpsrc uses gnutls/libgcrypt,
 * which aborts at init in that environment ("no entropy gathering module
 * detected" -> SIGABRT) before the TLS handshake. So we fetch the clip with curl
 * (its OpenSSL is happy seeding from /dev/urandom) to a local temp file, then
 * play that file with gst "filesrc" - a pipeline that needs no TLS and no entropy.
 *
 * Pause/resume use SIGSTOP/SIGCONT on the gst-launch process (freeze/thaw),
 * which preserves position.
 *
 * Seek: gst-launch-0.10 has no interactive control channel (no CLI flag, no stdin
 * command) to seek a LIVE pipeline - it's fire-and-forget. But now that full tracks are
 * decrypted to a local file first (not streamed), ffmpeg (present on-device) can cut a
 * fragment starting at the target time with `-ss <t> -c copy` (stream copy - fast, no
 * re-encode, and AAC has no video-style keyframe gap so seek accuracy is essentially
 * frame-exact) - then we play THAT fragment with the same filesrc pipeline. See seekTo().
 *
 * Volume: com.palm.audio's media/setVolume and media/getVolume are PRIVATE-BUS-ONLY -
 * confirmed via live device testing (luna-send -P -a com.achunt.jukie ... returns
 * "Unknown method \"setVolume\" for category \"/media\"", even though the identical call
 * succeeds on the private bus). Our own service's role file also has no outbound private-bus
 * permission ("outbound":[]), so there's no way to reach it either. So there is NO way for a
 * 3rd-party app to move the actual OS-wide volume on this platform - only lockVolumeKeys
 * (letting the hardware rocker adjust the system's media volume) is public, and it's already
 * wired in app.js. Instead, this service gives the on-screen slider a REAL, working volume by
 * controlling the gain of our OWN PulseAudio stream: every gst-launch pulsesink connection
 * shows up as a distinct "sink input" on the pcm_output hw sink (the same sink _suspendSink
 * already operates on for pause), and pactl can set THAT ONE stream's volume independently of
 * the shared sink/system level (confirmed live: the sink itself always sits at 100%/0dB - all
 * per-stream gain happens at the sink-input layer). See setVolume()/_applyVolume().
 *
 * OPEN FINDING (2026-07-30, not yet investigated/fixed): on-device testing showed the
 * VERY FIRST track played after a fresh service start plays at full volume, ignoring the
 * hardware volume rocker entirely - but starting with the SECOND track, the hardware
 * rocker correctly controls it (the stream gets recognized as "Media volume" like any
 * other app). This means the earlier "no way to respect system volume" conclusion above
 * may be incomplete: whatever categorizes a PulseAudio sink-input as rocker-controllable
 * "media" (likely a stream property/role tag, e.g. media.role, that pulsesink either
 * doesn't set on the FIRST connection of a fresh gst-launch/pulsesink pairing, or that
 * takes one cycle to get picked up by whatever routes volume-key events) is plausibly
 * fixable without needing the privileged com.palm.audio/system API at all. Worth
 * `pactl list sink-inputs` on the very first vs. second track's sink-input to diff their
 * properties before assuming this needs the privileged API / a com.palm.* app id.
 */
require = IMPORTS.require;
var cp = require('child_process');
var fs = require('fs');

var GST = '/usr/bin/gst-launch-0.10';
var PACTL = '/usr/bin/pactl';
var SINK = 'pcm_output'; // the ALSA output sink (from module-alsa-sink sink_name)
var CURL = '/usr/bin/curl'; // jail wrapper that sets CA bundle + LD_LIBRARY_PATH
var DD = '/bin/dd';
var TMP_FILE = '/tmp/jukie-preview.m4a'; // /tmp is writable inside the jail
var SEEK_FILE = '/tmp/jukie-seek.m4a'; // seek-fragment output, overwritten per seek
var DEFAULT_PREVIEW_DURATION = 30; // Apple preview clips are ~30s; refined if known

// jukie-drm: our static ARM helper that does the full-track Apple Music Widevine flow
// (webPlayback -> license -> download -> decrypt) and writes a plain .m4a. It lives in
// this service dir (so device.wvd + secrets.local.json sit next to it). Output goes to
// a song-id-keyed path in /tmp, which doubles as a simple session cache.
//
// The package ships BOTH webOS-version builds (see jukie-drm/build.ps1) so the one
// package works on either device - which one actually gets exec'd is decided here, at
// service load, by the exact same hardware probe used below to pick the AAC decode path
// (hardwareAACAvailable(), defined further down - hoisted, so callable here): a
// TouchPad/webOS3-class jail can reach the DSP, a webOS2-class jail (Pre2 and older)
// cannot. Reusing that one probe for both decisions keeps this to a single source of
// truth instead of a second device check that could drift out of sync with the first.
var DRM = '/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm-' +
	(hardwareAACAvailable() ? 'webos3' : 'webos2');
// jukie-drm has no way to receive credentials per-invocation - it only ever reads this
// static file (working dir first, then next to the binary; both are this same directory
// when we spawn it, since child_process.spawn inherits our cwd by default). The app's
// Settings screen has no filesystem access of its own, so setCredentials() below is how
// a pasted Developer/Music User Token actually reaches jukie-drm - see setCredentials.
var SECRETS_FILE = '/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/secrets.local.json';
// Decrypted tracks are cached on the big persistent /media/internal partition (writable
// from the jail), NOT /tmp (a 40MB RAM disk wiped on reboot). This survives reboots and
// is the basis for offline play.
var CACHE_DIR = '/media/internal/.jukie/cache';
function songFile(songId) { return CACHE_DIR + '/' + songId + '.m4a'; }

// PulseAudio auth from inside the service jail.
//
// This service runs jailed as an unprivileged uid (5393 on this device). Its ONLY
// possible audio path is PulseAudio's unix socket: the jail's /dev contains just
// console/log/logdir/nduid/null/shm/urandom - no `snd` node at all - so alsasink
// is not an option, no matter what the jail conf's do_snd flag suggests.
//
// pulseaudio here runs per-user (not --system), so the live config is
// /etc/pulse/default.pa, which loads module-native-protocol-unix with NO
// auth-group and NO auth-anonymous => the daemon demands the shared cookie. That
// cookie is ~pulse/.pulse-cookie = /var/run/pulse/.pulse-cookie. The jail bind-
// mounts /var/run rw so the path IS reachable from in here; it's the file mode
// (0600, owner pulse) that decides whether we can actually read it.
//
// Point every pulse client (gst's pulsesink, and pactl) at that cookie explicitly.
// Without it the client can't authenticate, and because HOME is the app dir it
// then tries to mint its OWN cookie there - which is what produced the confusing
// "Home directory ... not ours" line. The visible symptom was NOT an error: gst
// logged "pipeline doesn't want to preroll" and exited with status 0, which the
// exit handler below correctly reads as a clean end-of-stream, so a track would
// "finish" a few seconds after starting with no audio and nothing in the log
// that looked like a failure. pactl failed identically, which is why volume
// lookups reported "no sink-input found".
var PULSE_COOKIE = '/var/run/pulse/.pulse-cookie';
var PULSE_SERVER = 'unix:/var/run/pulse/native';

// Different webOS product lines (TouchPad vs. Pre2/older phones) have shown DIFFERENT
// pulse/jail setups - only override the client's pulse env if the specific cookie path
// above actually exists and is readable HERE. Where it doesn't, leave the env untouched
// so whatever default resolution already worked on that device keeps working (computed
// once and cached; this can't change during the service's lifetime).
var _pulseCookieUsable = null;
function pulseCookieUsable() {
	if (_pulseCookieUsable === null) {
		try { _pulseCookieUsable = fs.statSync(PULSE_COOKIE).size > 0; }
		catch (e) { _pulseCookieUsable = false; }
	}
	return _pulseCookieUsable;
}

// Our env plus the pulse pointers (if usable - see above), for spawning any pulse-facing
// child.
function pulseEnv() {
	var e = {}, k;
	for (k in process.env) {
		if (Object.prototype.hasOwnProperty.call(process.env, k)) { e[k] = process.env[k]; }
	}
	if (pulseCookieUsable()) {
		e.PULSE_COOKIE = PULSE_COOKIE;
		e.PULSE_SERVER = PULSE_SERVER;
	}
	return e;
}

// Whether THIS device's jail can actually reach the hardware AAC codec - see
// _playFile's big comment for the full story. TouchPad's jail can; a Pre2-class
// jail runs under a uid not in group `luna` and gets EACCES on the DSP device.
//
// This used to be learned reactively: try hardware on the first real track, and
// only fall back to software after watching it visibly fail. That worked, but it
// meant every Pre2-class device paid for that discovery with an actual broken
// playback attempt on a real song the user tapped - not acceptable, so this
// probes for it once at service startup instead, before any track is ever
// played, so the very first real playback already uses the pipeline that works.
//
// Actually opening (then immediately closing) the device node is the only fully
// reliable way to answer this on a Node build this old: there's no fs.accessSync
// here to ask the OS directly, and hand-rolling uid/gid/supplementary-group
// arithmetic against stat's mode bits would still miss anything enforced beyond
// plain POSIX permissions. It's cheap (one syscall pair) and side-effect-free
// (opening this device doesn't itself start any audio operation), so there's no
// real cost to doing it unconditionally at load time rather than lazily.
function hardwareAACAvailable() {
	var fd;
	try { fd = fs.openSync('/dev/DspBridge', 'r+'); }
	catch (e) { return false; }
	try { fs.closeSync(fd); } catch (e2) {}
	return true;
}

// A spawn() failure for jukie-drm specifically means "the file isn't executable". Checked
// two different ways because this old Node build (0.4-era) does NOT behave like modern
// Node here - confirmed live on a real Pre2 (2026-07-31): spawn() does not emit an
// 'error' event with .code 'EACCES' for a non-executable file the way current Node does;
// instead the child "starts", then exits with code 127 and stderr
// "execvp(): Permission denied\n" (a shell-style exec failure, not a JS-level spawn
// error). So this checks BOTH an EACCES-style Error/.code (in case some other spawn path
// or Node build DOES report it that way) AND the execvp/"denied" stderr text actually
// observed - call it with either the spawn error object or the raw stderr buffer.
function isDrmPermissionError(x) {
	var s = '' + x;
	return !!((x && x.code === 'EACCES') || /EACCES/i.test(s) || (/execvp/i.test(s) && /denied/i.test(s)));
}

// ---------------------------------------------------------------------------
// Singleton player. All command assistants run in this one node process, so
// this object persists across Luna requests.
// ---------------------------------------------------------------------------
var JukiePlayer = {
	child: null,     // gst-launch process (playback)
	dl: null,        // curl/jukie-drm process (fetch in progress)
	gen: 0,          // playback generation; bumped on every kill/new track so that a
	                 // superseded process's async exit handler can't clobber current state
	buffering: false,// true while downloading, before playback starts
	state: 'idle',   // idle | playing | paused | ended | error
	url: '',         // identity of the current track ('song:<id>' or a preview URL)
	mediaFile: TMP_FILE, // local file the gst pipeline plays
	songId: '',      // set for full-track playback; '' for previews
	libraryId: '',
	startTime: 0,    // ms epoch that the current position=0 maps to
	pausedAt: 0,     // seconds, ABSOLUTE track position captured at pause (or mid-seek)
	duration: DEFAULT_PREVIEW_DURATION,
	lastError: '',
	// True when the MOST RECENT jukie-drm spawn failed specifically with EACCES - the
	// binary's executable bit didn't survive packaging/install on this device (confirmed
	// happening on a real Pre2 even with fix-ipk-exec.py's package-level chmod stamp; see
	// post-install-jukie.ps1's own comment for the full story and the on-device fix).
	// Surfaced in status() so the app can show an actionable message instead of a generic
	// "playback error" - see isDrmPermissionError below.
	permissionError: false,
	playRetries: 0,  // count of automatic respawns for the CURRENT track (see _playFile)
	MAX_PLAY_RETRIES: 2,
	// Different webOS devices need DIFFERENT AAC decode paths (see _playFile's big
	// comment): TouchPad's jail can reach the hardware DSP (decodebin -> PalmAudioDecoder
	// works, and is lighter-weight than software decode), while a jailed Pre2 cannot
	// (permission boundary) and needs the explicit software fallback. Rather than
	// hardcode a device check (fragile, and other devices may differ again), we PROBE -
	// but proactively, at load time (hardwareAACAvailable(), above), not by trying
	// hardware on the user's first real track and learning from a visible failure.
	// _playFile's exit handler still has a REACTIVE fallback for the same transition
	// (sawError && !preferSoftwareAAC), kept as a safety net in case some device passes
	// this open()-based probe but still fails for another reason - but the proactive
	// check below means that path is not expected to actually fire on any known device.
	preferSoftwareAAC: !hardwareAACAvailable(),
	seekOffset: 0,   // seconds into the ORIGINAL track that the CURRENTLY PLAYING file
	                 // actually starts at (0 normally; the seek target after seekTo() - the
	                 // file gst plays post-seek is a fresh fragment that starts AT that
	                 // point, not the original file from 0). position() adds this to the
	                 // current pipeline's own elapsed-time clock.
	seeking: false,  // true while ffmpeg is cutting the seek fragment (position frozen)
	volume: 100,     // 0-100, this app's OWN PulseAudio stream gain (see file header - there
	                 // is no reachable API to set the real system volume from here)

	log: function (msg) {
		// console.error, not console.log: confirmed on-device (this session) that
		// console.log from this service never reaches /var/log/messages, even for
		// calls proven to succeed by their actual returned data - only error-level
		// calls surface, same as the WebKit app side.
		if (typeof console !== 'undefined' && console.error) {
			console.error('[JukiePlayer] ' + msg);
		}
	},

	// This node build does not reliably deliver signals via child.kill() (SIGCONT
	// in particular silently no-ops, and SIGKILL won't reach a SIGSTOP'd child).
	// Shell out to busybox `kill`, which works for STOP/CONT/KILL alike.
	_signal: function (signame, pid) {
		pid = pid || (this.child && this.child.pid);
		if (!pid) { return; }
		try { cp.spawn('/bin/sh', ['-c', 'kill -' + signame + ' ' + pid]); }
		catch (e) { this.log('signal ' + signame + ' (' + pid + ') failed: ' + e); }
	},

	// Real pause = suspend the ALSA sink. SIGSTOP only freezes gst, but PulseAudio's
	// own clock keeps running and plays silence, so audio "kept playing" during a
	// SIGSTOP pause. Suspending the sink closes the audio device, freezing the clock;
	// un-suspend resumes from the same spot. It's a GLOBAL toggle on the output sink,
	// so we must un-suspend whenever playback is torn down/replaced (see _kill).
	_suspendSink: function (yes) {
		try { cp.spawn(PACTL, ['suspend-sink', SINK, yes ? '1' : '0'], { env: pulseEnv() }); }
		catch (e) { this.log('suspend-sink ' + yes + ' failed: ' + e); }
	},

	// 0-100 -> this pactl build's raw volume scale (PA_VOLUME_NORM = 65536 = 100%). Confirmed
	// live that this ancient pactl 0.9.22 rejects the modern "NN%" syntax ("Invalid volume
	// specification") - it wants the raw integer.
	_volRaw: function (pct) {
		return Math.round(Math.max(0, Math.min(100, pct)) / 100 * 65536);
	},

	// `pactl list sink-inputs` has no machine-readable output mode on this ancient version -
	// text-scrape it for the "Sink Input #N" block whose application.process.id matches pid.
	_findSinkInputIndex: function (text, pid) {
		var lines = text.split('\n');
		var curIdx = null;
		for (var i = 0; i < lines.length; i++) {
			var m = lines[i].match(/^Sink Input #(\d+)/);
			if (m) { curIdx = m[1]; continue; }
			if (/^[A-Za-z]/.test(lines[i])) { curIdx = null; continue; } // next top-level block
			if (curIdx !== null && lines[i].indexOf('application.process.id') !== -1 &&
			    lines[i].indexOf('"' + pid + '"') !== -1) {
				return curIdx;
			}
		}
		return null;
	},

	// Applies this.volume to whatever sink-input belongs to the currently-playing gst-launch
	// child. No-op if nothing is playing right now - a fresh spawn re-applies it (see
	// _playFile), so a volume change made while paused/stopped still takes effect once
	// playback (re)starts.
	//
	// retriesLeft: right after a fresh spawn, pulsesink hasn't necessarily registered its
	// sink-input with the PulseAudio server yet (confirmed live: a real filesrc/decodebin/
	// pulsesink pipeline can take noticeably longer than a trivial test pipeline to connect -
	// a single fixed delay missed it), so retry a few times with a short backoff instead of
	// guessing one magic delay. A live setVolume() call while already playing (the common
	// case - the sink-input has existed for a while) always finds it on the first try.
	_applyVolume: function (retriesLeft) {
		var self = this;
		if (!this.child || !this.child.pid) { return; }
		var pid = this.child.pid;
		var myGen = this.gen;
		if (retriesLeft === undefined) { retriesLeft = 5; }
		var list = cp.spawn(PACTL, ['list', 'sink-inputs'], { env: pulseEnv() });
		var out = '';
		if (list.stdout) { list.stdout.on('data', function (d) { out += d; }); }
		list.on('exit', function () {
			if (myGen !== self.gen) { return; } // superseded - don't touch a newer stream
			var idx = self._findSinkInputIndex(out, pid);
			if (idx === null) {
				if (retriesLeft > 0) {
					setTimeout(function () { if (myGen === self.gen) { self._applyVolume(retriesLeft - 1); } }, 300);
				} else {
					self.log('_applyVolume: no sink-input found for pid ' + pid + ' (gave up)');
				}
				return;
			}
			try { cp.spawn(PACTL, ['set-sink-input-volume', idx, String(self._volRaw(self.volume))], { env: pulseEnv() }); }
			catch (e) { self.log('set-sink-input-volume failed: ' + e); }
		});
	},

	_kill: function () {
		this.gen++; // supersede any in-flight process: their exit handlers will no-op
		this._suspendSink(false); // never leave the output sink suspended across teardown
		if (this.dl) {
			try { this.dl.kill('SIGKILL'); } catch (e) {}
			this.dl = null;
		}
		if (this.child) {
			this._signal('KILL', this.child.pid);
			this.child = null;
		}
	},

	_fail: function (msg) {
		this.log(msg);
		this.state = 'error';
		this.lastError = msg;
		this._kill();
	},

	_fileReady: function (path) {
		try { return fs.statSync(path).size > 0; } catch (e) { return false; }
	},

	// Bound the on-disk cache so it can't grow without limit. /media/internal has GBs,
	// so we keep a generous LRU (current + maxOthers newest tracks), evicting the rest.
	// (A future db8-backed cache can pin/manage this more cleverly.)
	_capCache: function (keep, maxOthers) {
		try {
			var dir = CACHE_DIR, names = fs.readdirSync(dir), list = [], i;
			for (i = 0; i < names.length; i++) {
				var n = names[i], p = dir + '/' + n;
				if (n.substr(n.length - 4) === '.m4a' && p !== keep) {
					try { list.push({ p: p, t: fs.statSync(p).mtime.getTime() }); } catch (e) {}
				}
			}
			list.sort(function (a, b) { return b.t - a.t; }); // newest first
			for (i = maxOthers; i < list.length; i++) {
				try { fs.unlinkSync(list[i].p); } catch (e) {}
				try { fs.unlinkSync(list[i].p + '.json'); } catch (e) {} // its metadata sidecar
			}
		} catch (e) { this.log('cache cap failed: ' + e); }
	},

	// Remove every cached track (Settings > "Clear Cache", separate from the on/off
	// toggle - clearing shouldn't require disabling caching). Keeps whatever's currently
	// playing (matches _capCache's "current" exemption) so it doesn't cut out mid-song.
	clearCache: function () {
		var removed = 0, freedBytes = 0;
		try {
			var dir = CACHE_DIR, names = fs.readdirSync(dir), i;
			for (i = 0; i < names.length; i++) {
				var n = names[i], p = dir + '/' + n;
				if (n.substr(n.length - 4) !== '.m4a' || p === this.mediaFile) { continue; }
				try {
					freedBytes += fs.statSync(p).size;
					fs.unlinkSync(p);
					try { fs.unlinkSync(p + '.json'); } catch (e) {}
					removed++;
				} catch (e) {}
			}
		} catch (e) { this.log('clearCache failed: ' + e); }
		return { returnValue: true, removed: removed, freedBytes: freedBytes };
	},

	// Begin "playing" state for a fresh fetch (preview or full track).
	_beginFetch: function () {
		this._kill();
		this.state = 'playing';   // optimistic: UI shows "playing" during the brief fetch
		this.lastError = '';
		this.permissionError = false; // a fresh attempt might not hit it even if the last one did
		this.pausedAt = 0;
		this.startTime = 0;       // position stays 0 until the file actually starts playing
		this.buffering = true;    // true while fetching (before gst starts)
		this.playRetries = 0;     // reset the early-death retry counter for this track
		this.seekOffset = 0;      // a NEW track always starts fresh, not offset by a stale seek
		this.seeking = false;
	},

	// Full-track playback: run jukie-drm (Widevine) to produce a decrypted .m4a, then
	// play it. /tmp/jukie-<id>.m4a doubles as a session cache - a re-play is instant.
	playSong: function (songId, libraryId) {
		var self = this;
		this._beginFetch();
		this.songId = songId;
		this.libraryId = libraryId || '';
		this.url = 'song:' + songId;
		this.mediaFile = songFile(songId);
		this.duration = DEFAULT_PREVIEW_DURATION; // until jukie-drm reports the real length
		this._capCache(this.mediaFile, 60); // keep current + 60 newest tracks (~430MB)

		// jukie-drm owns caching: on a cache hit it still does the quick webPlayback so
		// it always reports the real duration (vital - else _checkEnded caps a cached
		// full track at 30s). So we always run it; cache hits are ~1s instead of ~6s.
		var myGen = this.gen; // this playback's generation; ignore exits once superseded
		var args = ['-json', '-o', this.mediaFile, songId];
		if (libraryId) { args.push(libraryId); }
		this.log('drm: ' + DRM + ' ' + args.join(' '));
		var dl = cp.spawn(DRM, args);
		this.dl = dl;

		var outbuf = '', errbuf = '';
		if (dl.stdout) { dl.stdout.on('data', function (d) { outbuf += d; }); }
		if (dl.stderr) { dl.stderr.on('data', function (d) { errbuf += d; self.log('drm: ' + d); }); }
		dl.on('error', function (e) {
			if (myGen !== self.gen) { return; }
			if (isDrmPermissionError(e)) { self.permissionError = true; }
			self._fail('jukie-drm spawn error: ' + e);
		});
		dl.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; } // a newer track took over
			self.dl = null;
			if (self.state !== 'playing') { return; } // stopped while fetching
			var res = null;
			try { res = JSON.parse(outbuf); } catch (e) {}
			if (code !== 0 || !res || !res.ok) {
				if (isDrmPermissionError(errbuf)) { self.permissionError = true; }
				self._fail('jukie-drm failed: ' + (res && res.error ? res.error : ('exit ' + code + ' ' + errbuf)));
				return;
			}
			if (res.durationMs) { self.duration = res.durationMs / 1000; }
			self.mediaFile = res.path || self.mediaFile;
			self._playFile();
		});
	},

	// apiGet: proxy one Apple Music REST API request through jukie-drm.
	//
	// Why this is here at all: the webOS 2.x in-app browser CANNOT reach Apple.
	// Its TLS stack is too old to complete a handshake with Apple's servers -
	// verified on-device with a probe matrix: plain https:// to other hosts
	// returns 200, but every Apple host fails with status=0, exactly like the
	// device's system curl (OpenSSL 0.9.8k) does. That's a platform limit with no
	// JS-side fix, so the app can't call the API itself. jukie-drm carries its own
	// modern TLS stack and an embedded CA bundle, so it proxies the request here.
	// (webOS 3.x / TouchPad has a newer WebKit and doesn't need this - the Enyo
	// app still calls the API directly there.)
	//
	// done(result) receives {returnValue:true, json} or {returnValue:false, error}.
	apiGet: function (path, done) {
		var self = this;
		if (!path) { done({returnValue: false, error: 'apiGet: path required'}); return; }
		this.log('api: ' + path);
		var p = cp.spawn(DRM, ['-api', path]);
		var outbuf = '', errbuf = '';
		if (p.stdout) { p.stdout.on('data', function (d) { outbuf += d; }); }
		if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
		p.on('error', function (e) {
			if (isDrmPermissionError(e)) { self.permissionError = true; }
			done({returnValue: false, error: 'jukie-drm spawn error: ' + e, permissionError: isDrmPermissionError(e)});
		});
		p.on('exit', function (code) {
			var json = null;
			try { json = JSON.parse(outbuf); } catch (e) {}
			if (code !== 0) {
				// jukie-drm prints Apple's own error JSON even on a non-2xx, which is
				// far more useful to surface than a bare exit code - pass it along.
				self.log('api failed: ' + errbuf);
				if (isDrmPermissionError(errbuf)) { self.permissionError = true; }
				done({
					returnValue: false, error: (errbuf || ('exit ' + code)).replace(/\s+$/, ''), json: json,
					permissionError: isDrmPermissionError(errbuf)
				});
				return;
			}
			if (!json) {
				done({returnValue: false, error: 'apiGet: could not parse response'});
				return;
			}
			done({returnValue: true, json: json});
		});
	},

	// Two-stage: curl the HTTPS preview to a local file, then play it with gst.
	// (See the file header for why we can't hand the HTTPS url straight to gst.)
	_spawn: function (url) {
		var self = this;
		this._beginFetch();
		this.songId = '';
		this.url = url;
		this.mediaFile = TMP_FILE;
		this.duration = DEFAULT_PREVIEW_DURATION;

		var myGen = this.gen;
		var curlArgs = ['-ksSL', '-o', TMP_FILE, url];
		this.log('curl: ' + CURL + ' ' + curlArgs.join(' '));
		var dl = cp.spawn(CURL, curlArgs);
		this.dl = dl;

		var errbuf = '';
		if (dl.stderr) {
			dl.stderr.on('data', function (d) { errbuf += d; self.log('curl stderr: ' + d); });
		}
		dl.on('error', function (e) { if (myGen !== self.gen) { return; } self._fail('curl spawn error: ' + e); });
		dl.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; } // a newer track took over
			self.dl = null;
			if (self.state !== 'playing') { return; } // stopped while downloading
			if (code !== 0) { self._fail('curl exit code ' + code + ' ' + errbuf); return; }
			self._playFile();
		});
	},

	// overrideFile: when set (post-seek), play THIS fragment instead of the canonical
	// this.mediaFile - the caller (seekTo/_runSeek) is responsible for setting
	// this.seekOffset to match where the fragment actually starts.
	_playFile: function (overrideFile) {
		var self = this;
		var myGen = this.gen;
		var playFile = overrideFile || this.mediaFile;

		// buffer-time caps how much audio PulseAudio buffers ahead of gst. Without it,
		// gst (reading a local file) races ahead and fills seconds of pulse buffer, so a
		// SIGSTOP pause keeps playing that buffer. ~250ms keeps pause near-instant.
		//
		// Decode path: HARDWARE (decodebin, auto-selecting the device's AAC decoder) is
		// tried first - this is the original, lighter-weight path that TouchPad's jail can
		// actually use. Only after that's been observed to fail on THIS device (see the
		// exit handler below) do we switch to the explicit SOFTWARE path.
		//
		// The software path is needed on devices (confirmed: Pre2) whose jail can't reach
		// the hardware AAC codec: decodebin there auto-selects PalmAudioDecoder, an OpenMAX
		// wrapper around the TI hardware AAC codec on the DSP, which needs /dev/DspBridge -
		// `crw-rw---- root luna`. A service jailed under an unprivileged uid NOT in group
		// `luna` can't open it:
		//   DSP Manager Open : Err Num = 80008008
		//   OpenMAX error 0x80001001 (OMX_ErrorUndefined) configuring AAC codec
		//   ERROR: pipeline doesn't want to preroll.
		// (This is exactly why playback "worked from a root shell but never from the app"
		// on that device - root can open the DSP, the jailed service cannot. It's a
		// permission boundary, not a codec or file problem.) ffdec_aac is a pure-userspace
		// decoder needing no device node; jukie-drm always hands us raw ADTS, so aacparse
		// framing it directly is enough (no demuxer at all) once we're on this path.
		//
		// NB: do not add audioresample to EITHER pipeline - it doesn't exist on these
		// devices; streams play at their native rate.
		var args = this.preferSoftwareAAC ?
			['filesrc', 'location=' + playFile,
			 '!', 'aacparse',
			 '!', 'ffdec_aac',
			 '!', 'audioconvert',
			 '!', 'pulsesink', 'buffer-time=250000'] :
			['filesrc', 'location=' + playFile,
			 '!', 'decodebin',
			 '!', 'audioconvert',
			 '!', 'pulsesink', 'buffer-time=250000'];

		this.log('spawn (' + (this.preferSoftwareAAC ? 'software' : 'hardware') + '): ' + GST + ' ' + args.join(' '));
		this.child = cp.spawn(GST, args, { env: pulseEnv() });
		this.startTime = Date.now();   // re-anchor position clock to actual playback start
		this.pausedAt = 0;
		this.buffering = false;
		this.state = 'playing';

		// Fresh process = fresh PulseAudio sink-input at default (100%) gain - re-apply
		// whatever volume was last set. Delayed since the sink-input doesn't exist the
		// instant gst spawns; pulsesink needs a moment to actually connect.
		(function (applyGen) {
			setTimeout(function () { if (applyGen === self.gen) { self._applyVolume(); } }, 300);
		})(this.gen);

		// gst-launch exits with status 0 even when the pipeline never actually ran
		// (e.g. "ERROR: pipeline doesn't want to preroll." when a sink can't be
		// opened). Taken at face value that looks exactly like a clean end-of-track,
		// so a totally failed playback silently reported itself as "finished" with
		// nothing error-shaped anywhere. Watch stderr for gst's own ERROR lines and
		// remember them, so the exit handler can tell "played to the end" apart from
		// "never started".
		var sawError = false;
		if (this.child.stderr) {
			this.child.stderr.on('data', function (d) {
				var s = '' + d;
				if (s.indexOf('ERROR:') !== -1) { sawError = true; }
				self.log('gst stderr: ' + s);
			});
		}

		this.child.on('error', function (e) {
			if (myGen !== self.gen) { return; } // superseded
			self.log('spawn error: ' + e);
			self.state = 'error';
			self.lastError = '' + e;
			self.child = null;
		});

		this.child.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; } // a newer track took over; ignore this exit
			self.log('gst exit code=' + code + ' sig=' + sig);
			self.child = null;
			if (self.state !== 'playing') { return; }

			// pulsesink occasionally loses its PulseAudio connection right after the sink
			// wakes from suspend-on-idle (races with a track switch), and gst then exits
			// clean (code 0) after only a fraction of a second - NOT a real end-of-track.
			// Treating that as "ended" produced silent playback with the progress bar
			// still climbing (see JukieAudioService.js history). Detect an exit that's
			// much too early for the track's real duration and respawn instead.
			var elapsed = (Date.now() - self.startTime) / 1000;

			// SAFETY NET, not the primary mechanism any more: preferSoftwareAAC starts
			// out already correct for this device (hardwareAACAvailable() decided it at
			// load time, before any track was ever played). This only fires if hardware
			// looked reachable at startup but still failed for some other reason - learn
			// to prefer software from now on, and retry THIS SAME file immediately on the
			// software pipeline instead of surfacing an error. One-time transition: once
			// preferSoftwareAAC is true this branch can never fire again, so a
			// software-path failure falls through to the normal error handling below
			// rather than looping.
			if (sawError && !self.preferSoftwareAAC) {
				self.log('hardware decode failed after ' + elapsed.toFixed(2) + 's - switching to software AAC decode for this device');
				self.preferSoftwareAAC = true;
				self._playFile(overrideFile);
				return;
			}

			var tooEarly = elapsed < 2 && elapsed < (self.duration - 1);
			if (tooEarly && self.playRetries < self.MAX_PLAY_RETRIES) {
				self.playRetries++;
				self.log('gst died after ' + elapsed.toFixed(2) + 's (retry ' + self.playRetries + '/' + self.MAX_PLAY_RETRIES + ')');
				self._playFile(overrideFile);
				return;
			}

			// If we were still "playing", the process ended on its own (EOS) or died.
			// A gst-reported ERROR means the pipeline failed rather than reached EOS,
			// regardless of the exit status being 0 - surface that as a real error so
			// the UI says so instead of quietly claiming the track finished.
			if (sawError) {
				self.state = 'error';
				self.lastError = 'gst pipeline error (see service log); played ' + elapsed.toFixed(1) + 's of ' + self.duration + 's';
				return;
			}
			self.state = (code === 0) ? 'ended' : 'error';
			if (code !== 0) { self.lastError = 'gst exit code ' + code; }
		});
	},

	// play accepts { songId, libraryId } for a full track (Widevine), or { url } for a
	// preview clip. Re-pressing play on the paused current track resumes in place.
	play: function (args) {
		args = args || {};
		var id = args.songId ? ('song:' + args.songId) : args.url;
		if (id && id === this.url && this.state === 'paused' && this.child) {
			return this.resume();
		}
		if (args.songId) {
			this.playSong('' + args.songId, args.libraryId ? ('' + args.libraryId) : '');
		} else if (args.url) {
			this._spawn(args.url);
		} else if (this.url) {
			this._replay(); // replay current track (e.g. play after it ended)
		} else {
			this.state = 'error';
			this.lastError = 'play: no songId or url';
		}
		return this.status();
	},

	// Re-start the current track from the beginning, picking the right source.
	_replay: function () {
		if (this.songId) { this.playSong(this.songId, this.libraryId); }
		else if (this.url) { this._spawn(this.url); }
	},

	// Seek to an absolute position (seconds) in the CURRENT track. Kills the current
	// pipeline, cuts a fresh fragment starting at the target with ffmpeg, then plays that.
	// Works whether currently playing or paused; if paused, lands back in the paused state
	// at the new position rather than audibly resuming.
	seekTo: function (seconds) {
		if (!this.mediaFile || (!this.songId && !this.url)) {
			return this.status(); // nothing loaded to seek within
		}
		if (this.state !== 'playing' && this.state !== 'paused') {
			return this.status();
		}
		var target = Math.max(0, Math.min(seconds, this.duration || seconds));
		var wasPaused = (this.state === 'paused');
		this.log('seekTo: ' + target + 's of ' + this.duration + 's (wasPaused=' + wasPaused + ')');
		this._kill(); // stop current gst child, un-suspend sink, bump gen so old handlers no-op
		this.pausedAt = target;
		this.seekOffset = target;
		this.startTime = 0;
		this.seeking = true;
		this.buffering = true;
		this.state = 'playing'; // optimistic while the fragment cuts, matches _beginFetch's convention
		this._runSeek(target, wasPaused);
		return this.status();
	},

	_runSeek: function (target, wasPaused) {
		var self = this;
		var myGen = this.gen;
		// Seeking is a plain byte-offset cut, because what we play is raw ADTS AAC
		// (jukie-drm remuxes to it - see internal/remux). Every ADTS frame carries its
		// own sync word and header, and aacparse resynchronises at the next 0xFFF
		// boundary, so landing mid-frame costs at most one frame (~23ms) and needs no
		// container rewrite at all. Bitrate is effectively constant, so scaling the
		// offset by target/duration lands accurately.
		//
		// (ffmpeg is deliberately NOT used here any more: this build has no ADTS muxer
		// at all - confirmed live, "Requested output format 'adts' is not a suitable
		// output format" - so the best it could emit was MP4, which _playFile's
		// software pipeline intentionally no longer demuxes.)
		var size = 0;
		try { size = fs.statSync(this.mediaFile).size; } catch (e) {}
		if (!size || !this.duration) { this._fail('seek: unknown file size or duration'); return; }
		var BS = 4096;
		var skip = Math.floor((size * (target / this.duration)) / BS);
		var args = ['if=' + this.mediaFile, 'of=' + SEEK_FILE, 'bs=' + BS, 'skip=' + skip];
		this.log('dd seek: ' + DD + ' ' + args.join(' '));
		var dl = cp.spawn(DD, args);
		this.dl = dl;

		var errbuf = '';
		if (dl.stderr) { dl.stderr.on('data', function (d) { errbuf += d; }); }
		dl.on('error', function (e) { if (myGen !== self.gen) { return; } self._fail('dd seek spawn error: ' + e); });
		dl.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; } // a newer play/seek/stop superseded this
			self.dl = null;
			if (code !== 0) { self._fail('dd seek failed: exit ' + code + ' ' + errbuf); return; }
			self.seeking = false;
			self._playFile(SEEK_FILE);
			if (wasPaused) {
				// Land back in the paused state at the new position instead of audibly
				// resuming - signal immediately so the pulse buffer-time (250ms) gives
				// enough grace that no audio is actually heard before the freeze lands.
				self.pausedAt = target;
				self._suspendSink(true);
				self._signal('STOP');
				self.state = 'paused';
			}
		});
	},

	pause: function () {
		if (this.child && this.state === 'playing' && !this.buffering) {
			this.pausedAt = this.position();
			this._suspendSink(true); // freeze the audio device (the actual pause)
			this._signal('STOP');    // and freeze gst so it doesn't decode ahead
			this.state = 'paused';
		}
		return this.status();
	},

	resume: function () {
		if (this.child && this.state === 'paused') {
			// pausedAt is the ABSOLUTE track position, but position() adds seekOffset to
			// the CURRENT fragment's own elapsed-time clock - so anchor startTime using
			// how far into the FRAGMENT we are (pausedAt - seekOffset), not the absolute
			// pausedAt, or a resume after a seek would double-count the offset.
			this.startTime = Date.now() - Math.round((this.pausedAt - this.seekOffset) * 1000);
			this._suspendSink(false); // re-open the audio device first
			this._signal('CONT');     // then thaw gst
			this.state = 'playing';
		} else if (this.state !== 'playing' && this.url) {
			// Nothing frozen to thaw (e.g. ended) -> start fresh from the right source.
			this._replay();
		}
		return this.status();
	},

	stop: function () {
		this._kill();
		this.state = 'idle';
		this.pausedAt = 0;
		this.seekOffset = 0;
		this.seeking = false;
		return this.status();
	},

	// See the file header - this is our own per-app PulseAudio stream gain, not the real
	// system volume (which 3rd-party apps can't reach on this platform).
	setVolume: function (pct) {
		this.volume = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
		this._applyVolume(); // no-op if nothing is playing right now; re-applied on next spawn
		return this.status();
	},

	getVolume: function () {
		return { returnValue: true, volume: this.volume };
	},

	// Writes a Developer Token / Music User Token pasted into the app's Settings into
	// secrets.local.json, so jukie-drm's NEXT spawn (a fresh process each time, reading
	// this file fresh every run - see its findFile()) picks them up. Only overwrites the
	// fields actually provided, so saving Settings with just one field filled in doesn't
	// blank out an already-working credential. args keys match secrets.local.json's own
	// field names: webDeveloperToken, musicUserToken.
	setCredentials: function (args) {
		args = args || {};
		var current = {};
		try { current = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch (e) {}
		if (args.webDeveloperToken) { current.webDeveloperToken = args.webDeveloperToken; }
		if (args.musicUserToken) { current.musicUserToken = args.musicUserToken; }
		try {
			fs.writeFileSync(SECRETS_FILE, JSON.stringify(current, null, 2));
			return { returnValue: true };
		} catch (e) {
			return { returnValue: false, error: 'setCredentials: ' + e };
		}
	},

	position: function () {
		if (this.seeking) {
			return this.pausedAt; // frozen at the seek target while ffmpeg cuts the fragment
		}
		if (this.state === 'playing') {
			// While buffering (curl/ffmpeg still working) playback hasn't started: stay at
			// the seek offset (or 0) so the scrubber doesn't jump before audio begins.
			if (this.buffering || !this.startTime) { return this.seekOffset; }
			var pos = this.seekOffset + (Date.now() - this.startTime) / 1000;
			return pos > this.duration ? this.duration : pos; // never report past the end
		}
		if (this.state === 'ended') {
			return this.duration;
		}
		return this.pausedAt;
	},

	// Safety net: normally gst exits at EOS and the exit handler marks us 'ended'.
	// But if the pipeline ever fails to EOS cleanly (e.g. pulsesink flushed after a
	// long pause), a 'playing' track could otherwise tick forever. Once a playing
	// track has run past its duration, finalize it so position stops climbing and
	// the app advances.
	_checkEnded: function () {
		if (this.state === 'playing' && !this.buffering && this.startTime &&
		    this.seekOffset + (Date.now() - this.startTime) / 1000 >= this.duration) {
			this._kill();
			this.state = 'ended';
		}
	},

	status: function () {
		this._checkEnded();
		return {
			returnValue: true,
			state: this.state,
			isPlaying: this.state === 'playing',
			buffering: !!this.buffering,
			position: this.position(),
			duration: this.duration,
			volume: this.volume,
			url: this.url,
			songId: this.songId,
			error: this.lastError,
			permissionError: !!this.permissionError
		};
	}
};

// ---------------------------------------------------------------------------
// Command assistants. Each reads request params and returns the player status.
// ---------------------------------------------------------------------------
function readArgs(self, future) {
	if (self && self.controller && self.controller.args) { return self.controller.args; }
	if (future && future.args) { return future.args; }
	return {};
}

var PlayCommandAssistant = function () {};
PlayCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	future.result = JukiePlayer.play(args);
	return future;
};

var PauseCommandAssistant = function () {};
PauseCommandAssistant.prototype.run = function (future) {
	future.result = JukiePlayer.pause();
	return future;
};

var ResumeCommandAssistant = function () {};
ResumeCommandAssistant.prototype.run = function (future) {
	future.result = JukiePlayer.resume();
	return future;
};

var StopCommandAssistant = function () {};
StopCommandAssistant.prototype.run = function (future) {
	future.result = JukiePlayer.stop();
	return future;
};

var GetStatusCommandAssistant = function () {};
GetStatusCommandAssistant.prototype.run = function (future) {
	future.result = JukiePlayer.status();
	return future;
};

var ClearCacheCommandAssistant = function () {};
ClearCacheCommandAssistant.prototype.run = function (future) {
	future.result = JukiePlayer.clearCache();
	return future;
};

var SeekCommandAssistant = function () {};
SeekCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	future.result = JukiePlayer.seekTo(Number(args.seconds) || 0);
	return future;
};

var SetVolumeCommandAssistant = function () {};
SetVolumeCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	future.result = JukiePlayer.setVolume(args.volume);
	return future;
};

var GetVolumeCommandAssistant = function () {};
GetVolumeCommandAssistant.prototype.run = function (future) {
	future.result = JukiePlayer.getVolume();
	return future;
};

var SetCredentialsCommandAssistant = function () {};
SetCredentialsCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	future.result = JukiePlayer.setCredentials(args);
	return future;
};

// Async assistant: the result is filled in from the spawn callback rather than
// synchronously here, so the future stays pending until jukie-drm exits.
//
// CRITICAL: do NOT `return future` here (unlike every synchronous assistant above).
// The dispatcher (mojoservice's controller_service.js) does
// `command.future.now(assistant, assistant.run)`, and Future._docall treats any
// returned value with a `.then` method as an inner future to nest via
// `this.nest(v)`. Returning `future` itself means nesting the future inside
// itself - since its result isn't set yet, Future.nest() registers the future's
// own completion callback ON ITSELF, a self-referential wait that never resolves
// (confirmed on-device: apiGet hung indefinitely, while every other command here,
// which sets future.result BEFORE returning future, works fine - by the time
// THEIR nest() check runs, _result.isset is already true, so it takes nest()'s
// other, non-self-referential branch instead). Returning nothing here skips that
// whole nest/setResult branch, and the async future.result assignment below
// resolves the SAME future the dispatcher already attached its own reply
// listener to, exactly as intended.
var ApiGetCommandAssistant = function () {};
ApiGetCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	JukiePlayer.apiGet(args.path, function (res) { future.result = res; });
};
