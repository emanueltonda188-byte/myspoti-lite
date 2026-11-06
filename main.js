// MySpoti Lite 1.0.0 — a Myspoti extension for low-data listening.
//
// What it does:
//   - Small audio first: when a small file of the song exists (your own music
//     folder, or a free legal copy on Archive.org), it plays that instead of
//     the full Spotify stream. Otherwise it steps aside and Spotify plays.
//   - Offline: the same small files can be downloaded (pick "Small" quality
//     in Myspoti Downloads) and then play with no data at all.
//   - Data meter: estimates today's data use and warns past your daily limit.
//   - Smart Shuffle: a player button that shuffles the current list with a
//     real shuffle and no repeats until every song has played once.
//
// What it cannot do (honest limits, also in README.md):
//   - It cannot download Spotify's own streams. Spotify audio is locked
//     (DRM); only files from your own folder or free catalogues go offline.
//   - It cannot force Spotify's stream to a lower bitrate. For streams, use
//     Myspoti's own Data Saver + Low quality in Settings, Playback.
myspoti.log('myspoti-lite 1.0.0 loaded');

var EXT_ID = 'ke.tonda.myspoti_lite';
var INDEX_TTL_MS = 60 * 60 * 1000;     // re-read your folder index hourly
var MISS_TTL_MS = 24 * 60 * 60 * 1000; // remember "no small file" for a day
var RECENT_MAX = 200;                  // storage cap for recent plays
var INDEX_MAX = 500;                   // most folder entries kept in storage
var STREAM_KBPS = 160;                 // estimate for a Spotify stream
var LITE_KBPS = 96;                    // our small files are about 96 kbps

function hasFeature(name) {
  try { return !!(myspoti.features && myspoti.features.indexOf(name) >= 0); } catch (e) { return false; }
}

function getSetting(key, fallback) {
  try {
    var v = myspoti.settings.get(key);
    if (v === undefined || v === null || v === '') return fallback;
    return v;
  } catch (e) { return fallback; }
}

function storeGet(key, fallback) {
  try {
    var v = myspoti.storage.get(key);
    return (v === undefined || v === null) ? fallback : v;
  } catch (e) { return fallback; }
}

function storeSet(key, value) {
  try { myspoti.storage.set(key, value); }
  catch (e) {
    // Storage is 512 KB. Drop the miss cache and try once more.
    try { myspoti.storage.remove('miss'); myspoti.storage.set(key, value); } catch (e2) {}
  }
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/ +/g, ' ').replace(/^ | $/g, '');
}

function durClose(a, b, tol) {
  return !!(a && b && Math.abs(a - b) <= tol);
}

function joinUrl(base, file) {
  if (!base) return null;
  var b = String(base).replace(/\/+$/, '');
  var f = String(file).replace(/^\/+/, '');
  return b + '/' + f;
}

function todayKey() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return 'data.' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function mbPerMin(kbps) { return kbps * 60 / 8 / 1024; } // kbps -> MB per minute

// ---- Data meter -----------------------------------------------------------

function loadDay() {
  var d = storeGet(todayKey(), null);
  if (!d || typeof d !== 'object') d = { streamMb: 0, liteMb: 0, streamed: 0, liteSongs: 0, downloaded: 0 };
  return d;
}

function saveDay(d) { storeSet(todayKey(), d); }

function dayTotalMb(d) { return (d.streamMb || 0) + (d.liteMb || 0); }

var lastProgress = { uri: '', ms: 0 };

myspoti.on('playback', function (e) {
  try {
    if (!e || !e.track) return;
    var uri = e.track.uri || '';
    if (e.type === 'start') {
      lastProgress = { uri: uri, ms: 0 };
      var d0 = loadDay();
      if (e.origin === 'spotify') d0.streamed = (d0.streamed || 0) + 1;
      else if (e.origin === 'audio-source' || e.origin === 'download') d0.liteSongs = (d0.liteSongs || 0) + 1;
      saveDay(d0);
      return;
    }
    if (e.type === 'progress') {
      if (lastProgress.uri !== uri) { lastProgress = { uri: uri, ms: e.playedMs || 0 }; return; }
      var delta = (e.playedMs || 0) - lastProgress.ms;
      lastProgress.ms = e.playedMs || 0;
      if (delta <= 0 || delta > 20000) return;
      var mins = delta / 60000;
      var d = loadDay();
      if (e.origin === 'spotify') d.streamMb = (d.streamMb || 0) + mins * mbPerMin(STREAM_KBPS);
      else if (e.origin === 'audio-source' || e.origin === 'download') d.liteMb = (d.liteMb || 0) + mins * mbPerMin(LITE_KBPS);
      saveDay(d);
      maybeWarn(d);
      return;
    }
    if (e.type === 'end' && e.reason === 'finished' && uri) rememberPlayed(uri);
    if (e.type === 'skip' || e.type === 'end') lastProgress = { uri: '', ms: 0 };
  } catch (err) { /* never break playback for the meter */ }
});

function maybeWarn(d) {
  var limit = Number(getSetting('dataWarningMb', 100)) || 100;
  if (dayTotalMb(d) < limit) return;
  var key = 'warned.' + todayKey();
  if (storeGet(key, false)) return;
  storeSet(key, true);
  myspoti.notify('MySpoti Lite: today is already ~' + Math.round(dayTotalMb(d)) + ' MB. Lite files and downloads use less.');
}

function rememberPlayed(uri) {
  var win = Number(getSetting('recentWindow', 50)) || 50;
  if (win < 1) win = 1;
  if (win > RECENT_MAX) win = RECENT_MAX;
  var recent = storeGet('recent', []);
  if (!Array.isArray(recent)) recent = [];
  var out = [uri];
  for (var i = 0; i < recent.length && out.length < win; i++) {
    if (recent[i] !== uri) out.push(recent[i]);
  }
  storeSet('recent', out);
}

// ---- Small-file sources ---------------------------------------------------
// Order: your own music folder first, then a free legal copy on Archive.org.
// Both are best-effort. A song with no small file returns null and Spotify
// streams it as usual.

function ownLibraryBase() {
  var b = getSetting('ownLibrary', '');
  if (typeof b !== 'string') return '';
  return b.replace(/^\s+|\s+$/g, '');
}

function loadOwnIndex() {
  var base = ownLibraryBase();
  if (!base) return null;
  var now = Date.now();
  var cached = storeGet('ownIndex', null);
  var cachedAt = storeGet('ownIndexAt', 0);
  if (cached && Array.isArray(cached) && (now - cachedAt) < INDEX_TTL_MS) return cached;
  var r = myspoti.http.get(joinUrl(base, 'index.json'), { timeout: 4000 });
  if (!r.ok) { myspoti.log('own library index: HTTP ' + r.status); return null; }
  var list = r.json();
  if (!Array.isArray(list)) return null;
  if (list.length > INDEX_MAX) list = list.slice(0, INDEX_MAX);
  storeSet('ownIndex', list);
  storeSet('ownIndexAt', now);
  return list;
}

function matchOwn(track) {
  var list = loadOwnIndex();
  if (!list) return null;
  var base = ownLibraryBase();
  var i, e;
  if (track.isrc) {
    var isrc = String(track.isrc).toUpperCase().replace(/^\s+|\s+$/g, '');
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e && e.isrc && String(e.isrc).toUpperCase() === isrc && e.file) {
        return { url: joinUrl(base, e.file), mime: 'audio/mpeg', label: 'My library · small', provider: 'My library', isrcMatched: true };
      }
    }
  }
  var wantTitle = norm(track.title), wantArtist = norm(track.artist);
  for (i = 0; i < list.length; i++) {
    e = list[i];
    if (!e || !e.file) continue;
    // Exact title + artist. Duration must match when the entry has one;
    // entries without a duration (made without tags) match on names alone.
    if (norm(e.title) === wantTitle && norm(e.artist) === wantArtist && (!e.durationMs || durClose(e.durationMs, track.durationMs, 3000))) {
      return { url: joinUrl(base, e.file), mime: 'audio/mpeg', label: 'My library · small', provider: 'My library', isrcMatched: false };
    }
  }
  return null;
}

function parseLengthMs(len) {
  if (typeof len === 'number') return len * 1000;
  if (typeof len !== 'string') return null;
  var parts = len.split(':');
  var s = 0;
  for (var i = 0; i < parts.length; i++) s = s * 60 + (parseFloat(parts[i]) || 0);
  return s * 1000;
}

function matchArchive(track) {
  if (getSetting('quality', 'Smallest') !== 'Smallest') return null; // Balanced: own folder only
  if (getSetting('ccSources', true) === false) return null;
  var title = String(track.title || ''), artist = String(track.artist || '');
  if (!title || !artist) return null;
  var q = 'title:("' + title.replace(/"/g, '') + '") AND creator:("' + artist.replace(/"/g, '') + '") AND mediatype:audio';
  var r = myspoti.http.get('https://archive.org/advancedsearch.php?' + myspoti.query({ q: q, 'fl[]': 'identifier', rows: 5, output: 'json' }), { timeout: 4000 });
  if (!r.ok) return null;
  var docs = (r.json().response || {}).docs || [];
  var tried = 0;
  for (var i = 0; i < docs.length && tried < 2; i++) {
    var id = docs[i].identifier;
    if (!id) continue;
    tried++;
    var m = myspoti.http.get('https://archive.org/metadata/' + encodeURIComponent(id), { timeout: 3000 });
    if (!m.ok) continue;
    var files = m.json().files || [];
    for (var j = 0; j < files.length; j++) {
      var f = files[j];
      if (!f || !/\.mp3$/i.test(f.name || '')) continue;
      if (durClose(parseLengthMs(f.length), track.durationMs, 5000)) {
        return { url: 'https://archive.org/download/' + id + '/' + encodeURIComponent(f.name), mime: 'audio/mpeg', label: 'Archive.org · small', provider: 'Archive.org', isrcMatched: false };
      }
    }
  }
  return null;
}

// ---- Miss cache: do not re-search a song that had no small file -----------

function missKey(track) {
  return track.id ? 'id:' + track.id : 't:' + norm(track.title) + '|' + norm(track.artist);
}

function wasMiss(track) {
  var miss = storeGet('miss', {});
  var at = miss[missKey(track)];
  return !!(at && (Date.now() - at) < MISS_TTL_MS);
}

function markMiss(track) {
  var miss = storeGet('miss', {});
  if (typeof miss !== 'object' || miss === null) miss = {};
  miss[missKey(track)] = Date.now();
  var keys = Object.keys(miss);
  if (keys.length > 100) {
    keys.sort(function (a, b) { return miss[a] - miss[b]; });
    for (var i = 0; i < keys.length - 100; i++) delete miss[keys[i]];
  }
  storeSet('miss', miss);
}

function findSmallFile(track) {
  if (!track || !track.title) return null;
  if (wasMiss(track)) return null;
  var f = null;
  try { f = matchOwn(track); } catch (e) { myspoti.log('own library lookup failed: ' + e); }
  if (!f) {
    try { f = matchArchive(track); } catch (e) { myspoti.log('archive lookup failed: ' + e); }
  }
  if (!f) markMiss(track);
  return f;
}

// ---- Audio + download sources ---------------------------------------------

myspoti.provide('audio-source', function (track) {
  if (getSetting('quality', 'Smallest') === 'Best') return null;
  var f = findSmallFile(track);
  if (!f) return null;
  var ans = { url: f.url, mimeType: f.mime, codec: 'mp3', source: f.label };
  if (track.durationMs) ans.durationMs = track.durationMs;
  return ans;
});

myspoti.provide('download-source', function (track) {
  var f = findSmallFile(track);
  if (!f) return null;
  var d = loadDay();
  d.downloaded = (d.downloaded || 0) + 1;
  saveDay(d);
  var q = track.quality || 'small';
  if (q === 'small') {
    return [{ url: f.url, format: 'mp3', provider: f.provider, isrcMatched: !!f.isrcMatched }];
  }
  // Lite files are small by design. Say so instead of handing over a
  // 96 kbps file to someone who asked for CD quality.
  if (hasFeature('results')) return { outcome: 'quality-unavailable', available: ['small'] };
  return [{ url: f.url, format: 'mp3', provider: f.provider, isrcMatched: !!f.isrcMatched }];
});

// ---- Smart Shuffle --------------------------------------------------------
// A real shuffle (Fisher-Yates) over the current list, skipping songs played
// recently, so nothing repeats until every song has played once.

function spotifyPlayer() {
  if (myspoti.spotify && myspoti.spotify.player) return myspoti.spotify.player;
  return null;
}

function shuffleUris(uris) {
  var a = uris.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function unplayedFirst(uris) {
  if (getSetting('shuffleNoRepeat', true) === false) return uris;
  var recent = storeGet('recent', []);
  if (!Array.isArray(recent) || !recent.length) return uris;
  var fresh = [], i;
  for (i = 0; i < uris.length; i++) if (recent.indexOf(uris[i]) < 0) fresh.push(uris[i]);
  if (fresh.length >= 2) return fresh;
  if (fresh.length === 1 && uris.length > 1) {
    var rest = [];
    for (i = 0; i < uris.length; i++) if (fresh.indexOf(uris[i]) < 0) rest.push(uris[i]);
    return fresh.concat(shuffleUris(rest));
  }
  return uris; // everything played: start a new round
}

function playShuffled(contextUri, uris) {
  var player = spotifyPlayer();
  if (!player) { myspoti.notify('Smart Shuffle needs Myspoti 2.0.2 or newer'); return false; }
  var order = shuffleUris(unplayedFirst(uris));
  player.play(contextUri, order[0], 0, 0, order);
  try { player.setShuffle(true); } catch (e) {}
  myspoti.notify('Smart Shuffle on: ' + order.length + ' songs, no repeats');
  return true;
}

function tracksOf(contextUri) {
  var sp = myspoti.spotify;
  if (!sp) return null;
  var page = null;
  if (contextUri.indexOf('spotify:playlist:') === 0) page = sp.playlists.tracks(contextUri, 0, 100);
  else if (contextUri.indexOf('spotify:album:') === 0) page = sp.catalog.albumTracks(contextUri, 0, 50);
  else if (contextUri.indexOf(':collection:') >= 0) page = sp.library.likedTracks(0, 50);
  else if (contextUri.indexOf('spotify:artist:') === 0) return sp.catalog.artistTopTracks(contextUri);
  else return null;
  return (page && page.items) || null;
}

function trackUris(tracks) {
  var out = [], i;
  for (i = 0; i < (tracks || []).length; i++) if (tracks[i] && tracks[i].uri) out.push(tracks[i].uri);
  return out;
}

function smartShuffle() {
  try {
    var player = spotifyPlayer();
    if (!player) { myspoti.notify('Smart Shuffle needs Myspoti 2.0.2 or newer'); return; }
    var st = null;
    try { st = player.state(); } catch (e) { st = null; }
    var ctx = st && st.contextUri;
    if (!ctx) { myspoti.notify('Play a playlist, album or Liked Songs first, then Smart Shuffle'); return; }
    var uris = trackUris(tracksOf(ctx));
    if (!uris || uris.length < 2) { myspoti.notify('Not enough songs here to shuffle'); return; }
    playShuffled(ctx, uris);
  } catch (e) {
    myspoti.log('smart shuffle failed: ' + e);
    myspoti.notify('Smart Shuffle could not start here');
  }
}

function shuffleLiked() {
  try {
    var page = myspoti.spotify.library.likedTracks(0, 50);
    var uris = trackUris(page && page.items);
    if (!uris || uris.length < 2) { myspoti.notify('Like a few songs first, then shuffle them'); return; }
    playShuffled('spotify:collection:tracks', uris);
  } catch (e) {
    myspoti.log('shuffle liked failed: ' + e);
    myspoti.notify('Could not shuffle Liked Songs');
  }
}

// ---- Player button, Home, taps, status ------------------------------------

myspoti.provide('player', function (track) {
  return [{ type: 'button', label: 'Smart Shuffle', icon: 'shuffle', action: 'smart-shuffle' }];
});

myspoti.provide('home', function () {
  var d = loadDay();
  var line = 'Today: ~' + Math.round(dayTotalMb(d)) + ' MB · ' + (d.streamed || 0) + ' streamed · ' + (d.liteSongs || 0) + ' lite';
  var blocks = [{ type: 'section', title: 'MySpoti Lite — low data', blocks: [
    { type: 'text', text: line + '. Small files play first; downloads work offline.' },
    { type: 'button', label: 'Smart Shuffle Liked Songs', icon: 'shuffle', action: 'shuffle-liked' },
    { type: 'button', label: 'How much data today?', icon: 'chart', action: 'show-data' }
  ] }];
  try {
    var page = myspoti.spotify.library.likedTracks(0, 50);
    var liked = (page && page.items) || [];
    if (liked.length) {
      var picks = shuffleUris(liked).slice(0, 6);
      var items = [];
      for (var i = 0; i < picks.length; i++) {
        items.push({
          uri: picks[i].uri,
          title: picks[i].name || '',
          subtitle: (picks[i].artists && picks[i].artists[0] && picks[i].artists[0].name) || ''
        });
      }
      if (items.length) blocks[0].blocks.push({ type: 'tracks', title: 'Shuffle picks from Liked Songs', items: items });
    }
  } catch (e) { /* Home still shows without picks */ }
  return blocks;
});

myspoti.provide('tap', function (e) {
  try {
    if (!e) return;
    if (e.action === 'smart-shuffle') smartShuffle();
    else if (e.action === 'shuffle-liked') shuffleLiked();
    else if (e.action === 'show-data') {
      var d = loadDay();
      myspoti.notify('Today: ~' + Math.round(dayTotalMb(d)) + ' MB · ' + (d.streamed || 0) + ' streamed · ' + (d.liteSongs || 0) + ' lite · ' + (d.downloaded || 0) + ' downloaded');
    }
  } catch (err) { myspoti.log('tap failed: ' + err); }
});

myspoti.provide('status', function () {
  var base = ownLibraryBase();
  if (base) {
    try {
      var r = myspoti.http.get(joinUrl(base, 'index.json'), { timeout: 3000 });
      if (r.status === 200) return { live: true };
      return { live: false, detail: 'Your music folder did not answer (' + r.status + ')' };
    } catch (e) { return { live: true }; }
  }
  try {
    var a = myspoti.http.get('https://archive.org/advancedsearch.php?' + myspoti.query({ q: 'test', rows: 0, output: 'json' }), { timeout: 3000 });
    if (a.status === 200) return { live: true };
    return { live: false, detail: 'Archive.org is down (' + a.status + ')' };
  } catch (e) { return { live: true }; }
});

myspoti.on('setting', function (e) {
  try { if (e && e.key) myspoti.log('setting ' + e.key + ' changed'); } catch (err) {}
});
