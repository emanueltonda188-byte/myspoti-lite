// MySpoti Lite 1.1.0 — a Myspoti extension for low-data listening.
//
// What it does:
//   - Small audio first: when a small file of the song exists (your own music
//     folder, or a free legal copy on Archive.org), it plays that instead of
//     the full Spotify stream. Otherwise it steps aside and Spotify plays.
//   - Unstoppable: Myspoti asks for the next song 10 s after the one before
//     starts (track.ahead), so the small file is resolved early and the song
//     starts at once; a small file buffers fully in seconds, so a data drop
//     mid-song does not stop it. Downloaded lists play with data fully off.
//   - Offline: the same small files can be downloaded (pick "Small" quality
//     in Myspoti Downloads) and then play with no data at all.
//   - Data meter: estimates today's data use and warns past your daily limit.
//   - Smart Shuffle: a player button that shuffles the current list with a
//     real shuffle and no repeats until every song has played once.
//   - Moods: Rap, Chill, Nostalgia, Party, Workout, Focus, Sleep, Happy,
//     Sad and Love. Tap a mood on Home to see its songs from Liked Songs;
//     the player button becomes "Mood mix" and plays more of the mood of
//     the song that is playing, from whatever list is playing.
//
// What it cannot do (honest limits, also in README.md):
//   - It cannot download Spotify's own streams. Spotify audio is locked
//     (DRM); only files from your own folder or free catalogues go offline.
//   - It cannot force Spotify's stream to a lower bitrate. For streams, use
//     Myspoti's own Data Saver + Low quality in Settings, Playback.
//   - It cannot make a Spotify stream unstoppable. A song with no small file
//     still streams, and a stream can stall when the data dies. The fix is
//     a small file for it (your folder) or a downloaded list.
//   - Moods are guessed from artist, title, album, genre and year. A song
//     that matches nothing shows under no mood; your folder's index.json
//     can tag a song's mood exactly (see README).
myspoti.log('myspoti-lite 1.1.0 loaded');

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
      currentTrack = e.track || null;
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

var currentTrack = null; // last song that started playing (for Mood mix)

// ---- Moods ---------------------------------------------------------------
// Ten moods, guessed from artist, title, album, genre and year. A song can
// carry several moods. Your folder's index.json can tag a song exactly with
// a "mood" field (one mood, or a list); "year" before 2000 also means
// nostalgia. Nothing here is stored per song: it is computed when needed.

var MOODS = [
  { id: 'rap', label: 'Rap', keywords: ['rap', 'hip hop', 'hiphop', 'trap', 'drill', 'freestyle', 'cypher', 'mixtape'],
    artists: ['kendrick lamar', 'eminem', 'drake', 'j cole', 'pop smoke', 'travis scott', '21 savage', 'lil baby', 'future', 'kanye west', 'jay z', 'nas', 'tupac', '2pac', 'notorious b i g', 'biggie', 'snoop dogg', 'ice cube', 'dr dre', 'nicki minaj', 'cardi b', 'megan thee stallion', 'doja cat', 'lil wayne', 'rick ross', 'meek mill', 'lil durk', 'polo g', 'central cee', 'stormzy', 'dave', 'skepta'] },
  { id: 'chill', label: 'Chill', keywords: ['lofi', 'lo fi', 'chill', 'acoustic', 'unplugged', 'mellow', 'calm', 'ambient', 'soft', 'slow', 'coffee', 'sunday morning', 'bedroom'], artists: [] },
  { id: 'nostalgia', label: 'Nostalgia', keywords: ['old school', 'oldschool', 'classic', 'throwback', 'retro', 'vintage', '90s', '80s', '70s', 'greatest hits', 'remember', 'back in the day'],
    artists: ['tupac', '2pac', 'notorious b i g', 'biggie', 'bob marley', 'michael jackson', 'whitney houston', 'queen', 'the beatles', 'abba', 'elton john', 'madonna', 'prince', 'stevie wonder', 'marvin gaye', 'aretha franklin', 'james brown', 'fela kuti', 'brenda fassie', 'lucky dube'] },
  { id: 'party', label: 'Party', keywords: ['party', 'club', 'dance', 'turn up', 'lit', 'shots', 'weekend', 'fiesta', 'celebration'], artists: [] },
  { id: 'workout', label: 'Workout', keywords: ['workout', 'gym', 'running', 'training', 'pump', 'beast mode', 'energy', 'adrenaline'], artists: [] },
  { id: 'focus', label: 'Focus', keywords: ['focus', 'study', 'concentration', 'deep work', 'instrumental', 'piano', 'classical', 'study beats', 'lofi beats'], artists: [] },
  { id: 'sleep', label: 'Sleep', keywords: ['sleep', 'lullaby', 'dream', 'insomnia', 'rain sounds', 'white noise', 'night sounds'], artists: [] },
  { id: 'happy', label: 'Happy', keywords: ['happy', 'sunshine', 'good vibes', 'feel good', 'summer', 'smile', 'joy', 'bright'], artists: [] },
  { id: 'sad', label: 'Sad', keywords: ['sad', 'heartbreak', 'broken', 'tears', 'lonely', 'miss you', 'goodbye', 'pain', 'cry', 'hurt'], artists: [] },
  { id: 'love', label: 'Love', keywords: ['love', 'romantic', 'romance', 'baby', 'darling', 'forever', 'wedding', 'valentine', 'my heart'], artists: [] }
];

var GENRE_MOODS = {
  'hip hop': 'rap', 'hip-hop': 'rap', 'rap': 'rap', 'trap': 'rap', 'drill': 'rap', 'grime': 'rap',
  'lo-fi': 'chill', 'lofi': 'chill', 'ambient': 'chill', 'chill': 'chill', 'chillout': 'chill',
  'acoustic': 'chill', 'folk': 'chill', 'jazz': 'chill', 'reggae': 'chill',
  'dance': 'party', 'edm': 'party', 'house': 'party', 'techno': 'party', 'party': 'party',
  'afrobeat': 'party', 'afrobeats': 'party',
  'classical': 'focus', 'piano': 'focus', 'instrumental': 'focus', 'study': 'focus',
  'pop': 'happy', 'gospel': 'happy',
  'soul': 'love', 'r&b': 'love', 'rnb': 'love',
  'blues': 'sad', 'lullaby': 'sleep',
  'rock': 'workout', 'metal': 'workout'
};

function moodLabel(id) { for (var i = 0; i < MOODS.length; i++) if (MOODS[i].id === id) return MOODS[i].label; return id; }
function isMoodId(id) { for (var i = 0; i < MOODS.length; i++) if (MOODS[i].id === id) return true; return false; }
function trackTitle(t) { return (t && (t.title || t.name)) || ''; }
function trackArtists(t) {
  if (!t) return [];
  if (Array.isArray(t.artists)) {
    var out = [];
    for (var i = 0; i < t.artists.length; i++) if (t.artists[i] && t.artists[i].name) out.push(t.artists[i].name);
    return out;
  }
  if (t.artist) return [t.artist];
  return [];
}
function trackAlbum(t) {
  if (!t || !t.album) return '';
  if (typeof t.album === 'string') return t.album;
  return t.album.name || '';
}
function trackYear(t) {
  if (!t) return null;
  if (t.year) return Number(t.year) || null;
  if (t.album && typeof t.album === 'object') {
    if (t.album.year) return Number(t.album.year) || null;
    if (t.album.release_date) { var y = parseInt(String(t.album.release_date).slice(0, 4), 10); return y || null; }
  }
  return null;
}
function hasWord(text, kw) {
  // Exact word for short keywords (baby, sad, lit...), prefix for longer
  // ones so plurals match (dreams, classics) without matching "trapped".
  var words = String(text || '').split(' ');
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (!w) continue;
    if (kw.length <= 4) { if (w === kw) return true; }
    else if (w === kw || w.indexOf(kw) === 0) return true;
  }
  return false;
}
function matchesKeyword(text, kw) {
  var t = norm(text);
  if (kw.indexOf(' ') >= 0) return (' ' + t + ' ').indexOf(' ' + kw + ' ') >= 0;
  return hasWord(t, kw);
}

var ownMapCache = { at: 0, map: null };
function ownEntryMap() {
  var list = loadOwnIndex();
  if (!list) return null;
  var at = storeGet('ownIndexAt', 0);
  if (ownMapCache.map && ownMapCache.at === at) return ownMapCache.map;
  var map = {};
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (!e) continue;
    if (e.isrc) map['isrc:' + String(e.isrc).toUpperCase()] = e;
    map['t:' + norm(e.title) + '|' + norm(e.artist)] = e;
  }
  ownMapCache = { at: at, map: map };
  return map;
}
function ownEntryFor(track) {
  var map = ownEntryMap();
  if (!map || !track) return null;
  if (track.isrc) {
    var byIsrc = map['isrc:' + String(track.isrc).toUpperCase()];
    if (byIsrc) return byIsrc;
  }
  var artists = trackArtists(track);
  return map['t:' + norm(trackTitle(track)) + '|' + norm(artists[0] || '')] || null;
}

function moodsOf(track) {
  if (!track) return [];
  var out = [];
  function add(id) { if (isMoodId(id) && out.indexOf(id) < 0) out.push(id); }
  // 1. Your folder's own tag wins: index.json "mood" (+ "genre", "year").
  var entry = null;
  try { entry = ownEntryFor(track); } catch (e) { entry = null; }
  if (entry) {
    var ms = entry.mood;
    if (typeof ms === 'string') ms = [ms];
    if (Array.isArray(ms)) {
      for (var i = 0; i < ms.length; i++) add(String(ms[i]).toLowerCase().replace(/[^a-z]+/g, ''));
    }
    if (entry.genre) { var g = GENRE_MOODS[norm(entry.genre)]; if (g) add(g); }
    if (entry.year && Number(entry.year) < 2000) add('nostalgia');
    if (out.length) return out;
  }
  // 2. Genre on the Spotify track itself, when present.
  if (track.genre) { var g2 = GENRE_MOODS[norm(track.genre)]; if (g2) add(g2); }
  // 3. Keywords and artist names on title + artist + album.
  var text = norm(trackTitle(track) + ' ' + trackArtists(track).join(' ') + ' ' + trackAlbum(track));
  for (var m = 0; m < MOODS.length; m++) {
    var mood = MOODS[m];
    for (var k = 0; k < mood.keywords.length; k++) {
      if (matchesKeyword(text, mood.keywords[k])) { add(mood.id); break; }
    }
    if (out.indexOf(mood.id) < 0) {
      for (var a = 0; a < mood.artists.length; a++) {
        if (matchesKeyword(text, mood.artists[a])) { add(mood.id); break; }
      }
    }
  }
  // 4. Old songs are nostalgia.
  var y = trackYear(track);
  if (y && y < 2000) add('nostalgia');
  return out;
}

function likedTracksAll() {
  try {
    var page = myspoti.spotify.library.likedTracks(0, 50);
    return (page && page.items) || [];
  } catch (e) { return []; }
}
function likedSnapshot() {
  // One read of Liked Songs, reused for shuffle picks, moods and the
  // offline-readiness count, so Home does not ask three times.
  var liked = likedTracksAll();
  var items = [];
  var ready = 0;
  for (var i = 0; i < liked.length; i++) {
    var t = liked[i];
    var entry = null;
    try { entry = ownEntryFor(t); } catch (e) { entry = null; }
    if (entry) ready++;
    items.push({ track: t, moods: moodsOf(t) });
  }
  return { liked: liked, items: items, ready: ready, total: liked.length };
}
function moodTracks(id) {
  var snap = likedSnapshot();
  var out = [];
  for (var i = 0; i < snap.items.length; i++) {
    if (snap.items[i].moods.indexOf(id) >= 0) out.push(snap.items[i].track);
  }
  return out;
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
  // Myspoti asks for the next song 10 s after the one before starts
  // (track.ahead === true). Resolve it now, while there is time: the answer
  // is kept and played as it is when the song comes, and on Wi-Fi Myspoti
  // also pre-reads the first 512 KB of the file. Remember it for Home.
  var ahead = !!(track && track.ahead);
  var f = findSmallFile(track);
  if (ahead) {
    try { storeSet('nextReady', { title: trackTitle(track), artist: (trackArtists(track)[0] || ''), lite: !!f, at: Date.now() }); } catch (e) {}
    if (f) myspoti.log('ahead: small file ready for ' + trackTitle(track));
  }
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

function playShuffled(contextUri, uris, what) {
  var player = spotifyPlayer();
  if (!player) { myspoti.notify('Smart Shuffle needs Myspoti 2.0.2 or newer'); return false; }
  var order = shuffleUris(unplayedFirst(uris));
  player.play(contextUri, order[0], 0, 0, order);
  try { player.setShuffle(true); } catch (e) {}
  myspoti.notify((what || 'Smart Shuffle') + ' on: ' + order.length + ' songs, no repeats');
  return true;
}

function playMood() {
  try {
    var selected = storeGet('mood.selected', '');
    if (!selected || !isMoodId(selected)) { myspoti.notify('Pick a mood first'); return; }
    var uris = trackUris(moodTracks(selected));
    if (uris.length < 2) { myspoti.notify('Only ' + uris.length + ' ' + moodLabel(selected) + ' song' + (uris.length === 1 ? '' : 's') + ' in Liked Songs'); return; }
    playShuffled('spotify:collection:tracks', uris, 'Mood mix: ' + moodLabel(selected));
  } catch (e) {
    myspoti.log('play mood failed: ' + e);
    myspoti.notify('Could not play that mood');
  }
}

function moodMix() {
  try {
    var t = currentTrack;
    if (!t || !trackTitle(t)) { myspoti.notify('Play a song first, then Mood mix'); return; }
    var moods = moodsOf(t);
    if (!moods.length) { myspoti.notify('No mood for this song yet'); return; }
    var player = spotifyPlayer();
    if (!player) { myspoti.notify('Mood mix needs Myspoti 2.0.2 or newer'); return; }
    var st = null;
    try { st = player.state(); } catch (e) { st = null; }
    var ctx = st && st.contextUri;
    if (!ctx) { myspoti.notify('Play a playlist, album or Liked Songs first, then Mood mix'); return; }
    var mood = moods[0];
    var tracks = tracksOf(ctx) || [];
    var same = [];
    for (var i = 0; i < tracks.length; i++) {
      if (moodsOf(tracks[i]).indexOf(mood) >= 0) same.push(tracks[i]);
    }
    var uris = trackUris(same);
    if (uris.length < 2) { myspoti.notify('Only ' + uris.length + ' ' + moodLabel(mood) + ' song' + (uris.length === 1 ? '' : 's') + ' here'); return; }
    playShuffled(ctx, uris, 'Mood mix: ' + moodLabel(mood));
  } catch (e) {
    myspoti.log('mood mix failed: ' + e);
    myspoti.notify('Mood mix could not start here');
  }
}

function refreshHome() { try { if (myspoti.ui && myspoti.ui.refresh) myspoti.ui.refresh('home'); } catch (e) {} }

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
  // One player button per extension: when the song playing has a mood, the
  // button becomes Mood mix for that mood; otherwise it is Smart Shuffle.
  var moods = track ? moodsOf(track) : [];
  if (moods.length) {
    return [{ type: 'button', label: 'Mood mix · ' + moodLabel(moods[0]), icon: 'music', action: 'mood-mix' }];
  }
  return [{ type: 'button', label: 'Smart Shuffle', icon: 'shuffle', action: 'smart-shuffle' }];
});

function moodsSection(snap) {
  var selected = storeGet('mood.selected', '');
  var groups = {};
  for (var i = 0; i < snap.items.length; i++) {
    var ms = snap.items[i].moods;
    for (var j = 0; j < ms.length; j++) {
      if (!groups[ms[j]]) groups[ms[j]] = [];
      groups[ms[j]].push(snap.items[i].track);
    }
  }
  if (selected && groups[selected] && groups[selected].length) {
    var tracks = groups[selected];
    var items = [];
    for (var k = 0; k < tracks.length && k < 20; k++) {
      items.push({ uri: tracks[k].uri, title: trackTitle(tracks[k]), subtitle: trackArtists(tracks[k]).join(', ') });
    }
    return { type: 'section', title: 'Moods · ' + moodLabel(selected), blocks: [
      { type: 'text', text: moodLabel(selected) + ' · ' + tracks.length + ' song' + (tracks.length === 1 ? '' : 's') + ' from Liked Songs.' },
      { type: 'tracks', title: moodLabel(selected), items: items },
      { type: 'button', label: 'Play ' + moodLabel(selected) + ' shuffled', icon: 'shuffle', action: 'mood-play' },
      { type: 'button', label: 'All moods', icon: 'music', action: 'mood-clear' }
    ] };
  }
  var blocks = [{ type: 'text', text: 'Tap a mood to see its songs from Liked Songs.' }];
  var shown = 0;
  for (var m = 0; m < MOODS.length && shown < 10; m++) {
    var id = MOODS[m].id;
    if (groups[id] && groups[id].length) {
      blocks.push({ type: 'button', label: moodLabel(id) + ' · ' + groups[id].length, icon: 'music', action: 'mood-' + id });
      shown++;
    }
  }
  if (!shown) blocks.push({ type: 'text', text: 'No moods found yet — like some songs first.' });
  return { type: 'section', title: 'Moods', blocks: blocks };
}

myspoti.provide('home', function () {
  var d = loadDay();
  var line = 'Today: ~' + Math.round(dayTotalMb(d)) + ' MB · ' + (d.streamed || 0) + ' streamed · ' + (d.liteSongs || 0) + ' lite';
  var snap = null;
  try { snap = likedSnapshot(); } catch (e) { snap = { liked: [], items: [], ready: 0, total: 0 }; }
  var offLine = snap.total
    ? 'Unstoppable: ' + snap.ready + ' of ' + snap.total + ' Liked Songs have a small file. Download Liked Songs in Myspoti and they play with data off.'
    : 'Unstoppable: like some songs, add your MP3 folder, and they can play with data off.';
  var next = storeGet('nextReady', null);
  if (next && next.title && (Date.now() - (next.at || 0)) < 10 * 60 * 1000) {
    offLine += ' Next up: ' + next.title + (next.lite ? ' — small file ready.' : ' — streams on Spotify.');
  }
  var blocks = [{ type: 'section', title: 'MySpoti Lite — low data', blocks: [
    { type: 'text', text: line + '. Small files play first; downloads work offline.' },
    { type: 'text', text: offLine },
    { type: 'button', label: 'Smart Shuffle Liked Songs', icon: 'shuffle', action: 'shuffle-liked' },
    { type: 'button', label: 'Make it unstoppable', icon: 'download', action: 'unstoppable' },
    { type: 'button', label: 'How much data today?', icon: 'chart', action: 'show-data' }
  ] }];
  try {
    var liked = snap.liked;
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
  // Moods is the second Home section (the quota is two per extension).
  blocks.push(moodsSection(snap));
  return blocks;
});

myspoti.provide('tap', function (e) {
  try {
    if (!e) return;
    if (e.action === 'smart-shuffle') smartShuffle();
    else if (e.action === 'shuffle-liked') shuffleLiked();
    else if (e.action === 'mood-mix') moodMix();
    else if (e.action === 'mood-play') playMood();
    else if (e.action === 'mood-clear') { storeSet('mood.selected', ''); refreshHome(); }
    else if (e.action && e.action.indexOf('mood-') === 0) {
      var id = e.action.slice(5);
      if (isMoodId(id)) { storeSet('mood.selected', id); refreshHome(); }
    }
    else if (e.action === 'unstoppable') {
      myspoti.notify('Unstoppable: in Myspoti open Liked Songs or a playlist and tap Download — the extension gives tiny files, so the whole list stays small. Downloaded songs play with data off. Lite files also buffer in seconds, so a data drop rarely stops one mid-song.');
    }
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
