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
 */
require = IMPORTS.require;
var cp = require('child_process');
var fs = require('fs');

var GST = '/usr/bin/gst-launch-0.10';
var PACTL = '/usr/bin/pactl';
var SINK = 'pcm_output'; // the ALSA output sink (from module-alsa-sink sink_name)
var CURL = '/usr/bin/curl'; // jail wrapper that sets CA bundle + LD_LIBRARY_PATH
var FFMPEG = '/usr/bin/ffmpeg';
var TMP_FILE = '/tmp/jukie-preview.m4a'; // /tmp is writable inside the jail
var SEEK_FILE = '/tmp/jukie-seek.m4a'; // ffmpeg's seek-fragment output, overwritten per seek
var DEFAULT_PREVIEW_DURATION = 30; // Apple preview clips are ~30s; refined if known

// jukie-drm: our static ARM helper that does the full-track Apple Music Widevine flow
// (webPlayback -> license -> download -> decrypt) and writes a plain .m4a. It lives in
// this service dir (so device.wvd + secrets.local.json sit next to it). Output goes to
// a song-id-keyed path in /tmp, which doubles as a simple session cache.
var DRM = '/media/cryptofs/apps/usr/palm/services/com.achunt.jukie.service/jukie-drm';
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
	playRetries: 0,  // count of automatic respawns for the CURRENT track (see _playFile)
	MAX_PLAY_RETRIES: 2,
	seekOffset: 0,   // seconds into the ORIGINAL track that the CURRENTLY PLAYING file
	                 // actually starts at (0 normally; the seek target after seekTo() - the
	                 // file gst plays post-seek is a fresh fragment that starts AT that
	                 // point, not the original file from 0). position() adds this to the
	                 // current pipeline's own elapsed-time clock.
	seeking: false,  // true while ffmpeg is cutting the seek fragment (position frozen)
	volume: 100,     // 0-100, this app's OWN PulseAudio stream gain (see file header - there
	                 // is no reachable API to set the real system volume from here)

	log: function (msg) {
		if (typeof console !== 'undefined' && console.log) {
			console.log('[JukiePlayer] ' + msg);
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
		try { cp.spawn(PACTL, ['suspend-sink', SINK, yes ? '1' : '0']); }
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
		var list = cp.spawn(PACTL, ['list', 'sink-inputs']);
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
			try { cp.spawn(PACTL, ['set-sink-input-volume', idx, String(self._volRaw(self.volume))]); }
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
		dl.on('error', function (e) { if (myGen !== self.gen) { return; } self._fail('jukie-drm spawn error: ' + e); });
		dl.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; } // a newer track took over
			self.dl = null;
			if (self.state !== 'playing') { return; } // stopped while fetching
			var res = null;
			try { res = JSON.parse(outbuf); } catch (e) {}
			if (code !== 0 || !res || !res.ok) {
				self._fail('jukie-drm failed: ' + (res && res.error ? res.error : ('exit ' + code + ' ' + errbuf)));
				return;
			}
			if (res.durationMs) { self.duration = res.durationMs / 1000; }
			self.mediaFile = res.path || self.mediaFile;
			self._playFile();
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
		var args = ['filesrc', 'location=' + playFile,
		            '!', 'decodebin',
		            '!', 'audioconvert',
		            '!', 'pulsesink', 'buffer-time=250000'];

		this.log('spawn: ' + GST + ' ' + args.join(' '));
		this.child = cp.spawn(GST, args);
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

		if (this.child.stderr) {
			this.child.stderr.on('data', function (d) { self.log('gst stderr: ' + d); });
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
			var tooEarly = elapsed < 2 && elapsed < (self.duration - 1);
			if (tooEarly && self.playRetries < self.MAX_PLAY_RETRIES) {
				self.playRetries++;
				self.log('gst died after ' + elapsed.toFixed(2) + 's (retry ' + self.playRetries + '/' + self.MAX_PLAY_RETRIES + ')');
				self._playFile();
				return;
			}

			// If we were still "playing", the process ended on its own (EOS) or died.
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
		// -ss BEFORE -i = fast input-side seek; -acodec copy = stream copy, no re-encode.
		// (This device's ffmpeg is an ancient 2011 build - libavformat 52.x - that predates
		// the modern unified "-c" shorthand; confirmed via a live device test that it fails
		// with "Unrecognized option 'c'". Audio-only input, so -acodec copy is all we need.)
		// -f mp4: this ffmpeg build's --enable-muxer list only has mp4/mov/3gp/3g2/amr (no
		// adts muxer at all) - confirmed via a live device test ("Requested output format
		// 'adts' is not a suitable output format"). The source is already MP4/M4A, so mp4
		// output matches it exactly - gst's decodebin/qtdemux handles a trailing moov atom
		// (the default non-faststart layout) fine for straight playback.
		var args = ['-y', '-ss', String(target), '-i', this.mediaFile, '-acodec', 'copy', '-f', 'mp4', SEEK_FILE];
		this.log('ffmpeg seek: ' + FFMPEG + ' ' + args.join(' '));
		var dl = cp.spawn(FFMPEG, args);
		this.dl = dl;

		var errbuf = '';
		if (dl.stderr) { dl.stderr.on('data', function (d) { errbuf += d; }); }
		dl.on('error', function (e) { if (myGen !== self.gen) { return; } self._fail('ffmpeg seek spawn error: ' + e); });
		dl.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; } // a newer play/seek/stop superseded this
			self.dl = null;
			if (code !== 0) { self._fail('ffmpeg seek failed: exit ' + code + ' ' + errbuf); return; }
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
			error: this.lastError
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
