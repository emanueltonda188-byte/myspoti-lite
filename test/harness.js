// test/harness.js — runs main.js against a stubbed `myspoti` object in Node.
// No phone, no network: every http call is answered by a mock route.
// Run: node test/harness.js   (exit 1 when a check fails)
'use strict';
const fs = require('fs');

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

// ---- stub ---------------------------------------------------------------
const store = {};
const hooks = {};
const listeners = {};
const notifications = [];
const playedCalls = [];
const settings = {
  quality: 'Smallest', ccSources: true, ownLibrary: '',
  shuffleNoRepeat: true, recentWindow: 50, dataWarningMb: 100, automix: true,
};
const httpCalls = {};
const httpRoutes = [];
function mockHttp(match, handler) { httpRoutes.push({ match: match, handler: handler }); }

const likedTracks = [
  { uri: 'spotify:track:aaa', name: 'Money Trees', artists: [{ name: 'Kendrick Lamar' }], durationMs: 308000 },
  { uri: 'spotify:track:bbb', name: 'Dior', artists: [{ name: 'Pop Smoke' }], durationMs: 213000 },
  { uri: 'spotify:track:ccc', name: 'Alright', artists: [{ name: 'Kendrick Lamar' }], durationMs: 219000 },
  { uri: 'spotify:track:eee', name: 'Lofi Rain', artists: [{ name: 'Chillhop Music' }], durationMs: 180000 },
  { uri: 'spotify:track:fff', name: 'California Love', artists: [{ name: '2Pac' }], durationMs: 240000 },
  { uri: 'spotify:track:ggg', name: 'Party Rock Anthem', artists: [{ name: 'LMFAO' }], durationMs: 250000 },
  { uri: 'spotify:track:hhh', name: 'Rainy Days', artists: [{ name: 'Unknown Artist' }], durationMs: 200000, year: 1994 },
];
const playlistTracks = likedTracks.concat([
  { uri: 'spotify:track:ddd', name: 'HUMBLE.', artists: [{ name: 'Kendrick Lamar' }], durationMs: 177000 },
]);

function okJson(body) {
  return { ok: true, status: 200, json: function () { return body; }, text: function () { return JSON.stringify(body); }, headers: {} };
}
function failJson(status) {
  return { ok: false, status: status, json: function () { return {}; }, text: function () { return ''; }, headers: {} };
}

global.myspoti = {
  features: ['results', 'audio.ahead', 'status'],
  log: function () {},
  notify: function (t) { notifications.push(t); },
  query: function (o) {
    return Object.keys(o).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(o[k] == null ? '' : o[k]);
    }).join('&');
  },
  settings: { get: function (k) { return settings[k]; } },
  storage: {
    get: function (k) { return store[k]; },
    set: function (k, v) { store[k] = JSON.parse(JSON.stringify(v)); },
    remove: function (k) { delete store[k]; },
  },
  http: {
    get: function (url) {
      for (let i = 0; i < httpRoutes.length; i++) {
        if (url.indexOf(httpRoutes[i].match) >= 0) {
          httpCalls[httpRoutes[i].match] = (httpCalls[httpRoutes[i].match] || 0) + 1;
          return httpRoutes[i].handler(url);
        }
      }
      return failJson(404);
    },
  },
  provide: function (name, fn) { hooks[name] = fn; },
  on: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
  spotify: {
    player: {
      state: function () { return { contextUri: 'spotify:playlist:test123', shuffle: false, isPaused: false }; },
      play: function (ctx, track, index, pos, order) { playedCalls.push({ ctx: ctx, track: track, order: order }); },
      setShuffle: function () {},
    },
    playlists: { tracks: function () { return { items: playlistTracks }; } },
    catalog: {
      albumTracks: function () { return { items: playlistTracks.slice(0, 2) }; },
      artistTopTracks: function () { return playlistTracks.slice(0, 3); },
    },
    library: { likedTracks: function () { return { items: likedTracks }; } },
  },
  ui: { refresh: function () {} },
};

require('../main.js');

function callHook(name, arg) { return hooks[name](arg); }
function fireEvent(name, e) { (listeners[name] || []).forEach(function (fn) { fn(e); }); }
function resetAll() {
  for (const k of Object.keys(store)) delete store[k];
  notifications.length = 0;
  playedCalls.length = 0;
  for (const k of Object.keys(httpCalls)) delete httpCalls[k];
}
function todayKey() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return 'data.' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const moneyTrees = { id: 'x1', uri: 'spotify:track:aaa', title: 'Money Trees', artist: 'Kendrick Lamar', isrc: 'USUM71200905', durationMs: 308000 };
const unknownTrack = { id: 'x9', uri: 'spotify:track:zzz', title: 'No Such Song', artist: 'Nobody', durationMs: 200000 };

mockHttp('example.com/music/index.json', function () {
  return okJson([
    { isrc: 'USUM71200905', title: 'Money Trees', artist: 'Kendrick Lamar', durationMs: 308000, file: 'money-trees.mp3' },
    { title: 'Lofi Rain', artist: 'Chillhop Music', durationMs: 180000, file: 'lofi-rain.mp3', mood: 'chill', year: 2019 },
  ]);
});
mockHttp('archive.org', function (url) {
  // The status probe pings advancedsearch.php; song lookups get no match.
  if (url.indexOf('advancedsearch.php') >= 0) return okJson({ response: { docs: [] } });
  return failJson(404);
});

// 1. audio-source finds the own-library file by ISRC
resetAll();
settings.ownLibrary = 'https://example.com/music';
settings.quality = 'Smallest';
let ans = callHook('audio-source', moneyTrees);
check('audio-source returns own-library file by ISRC', ans && ans.url === 'https://example.com/music/money-trees.mp3', JSON.stringify(ans));
check('audio-source announces mp3', ans && ans.codec === 'mp3');

// 2. quality Best steps aside
settings.quality = 'Best';
check('audio-source returns null on Best quality', callHook('audio-source', moneyTrees) === null);
settings.quality = 'Smallest';

// 3. unknown track: null, and the miss cache stops a second search
resetAll();
settings.ownLibrary = '';
ans = callHook('audio-source', unknownTrack);
check('audio-source returns null with no small file', ans === null);
const archiveCallsAfterFirst = httpCalls['archive.org'] || 0;
ans = callHook('audio-source', unknownTrack);
check('miss cache avoids a second search', ans === null && (httpCalls['archive.org'] || 0) === archiveCallsAfterFirst,
  'archive calls: ' + (httpCalls['archive.org'] || 0));

// 4. download-source, small quality
resetAll();
settings.ownLibrary = 'https://example.com/music';
const dl = callHook('download-source', Object.assign({}, moneyTrees, { quality: 'small' }));
check('download-source returns an mp3 file for small quality',
  Array.isArray(dl) && dl.length === 1 && dl[0].format === 'mp3' && dl[0].url.indexOf('money-trees.mp3') >= 0,
  JSON.stringify(dl));
check('download-source marks ISRC match', Array.isArray(dl) && dl[0].isrcMatched === true);
const day = store[todayKey()];
check('download increments the day counter', day && day.downloaded === 1, JSON.stringify(day));

// 5. download-source, CD quality: honest outcome, not a small file in disguise
const dlCd = callHook('download-source', Object.assign({}, moneyTrees, { quality: 'cd' }));
check('download-source says quality-unavailable for CD',
  dlCd && dlCd.outcome === 'quality-unavailable' && dlCd.available && dlCd.available[0] === 'small',
  JSON.stringify(dlCd));

// 6. Smart Shuffle on the current playlist
resetAll();
callHook('tap', { action: 'smart-shuffle' });
check('smart shuffle plays the playlist context', playedCalls.length === 1 && playedCalls[0].ctx === 'spotify:playlist:test123',
  JSON.stringify(playedCalls));
const order = playedCalls.length ? playedCalls[0].order : [];
check('smart shuffle order has every song once',
  order.length === 8 && new Set(order).size === 8 && order.indexOf('spotify:track:aaa') >= 0);
check('smart shuffle notifies', notifications.some((t) => t.indexOf('Smart Shuffle on: 8 songs') === 0));

// 7. Smart Shuffle skips recently played songs
resetAll();
store.recent = ['spotify:track:aaa', 'spotify:track:bbb'];
callHook('tap', { action: 'smart-shuffle' });
const order2 = playedCalls.length ? playedCalls[0].order : [];
check('smart shuffle skips recent songs', order2.length === 6 && order2.indexOf('spotify:track:aaa') < 0 && order2.indexOf('spotify:track:bbb') < 0,
  JSON.stringify(order2));

// 8. Data meter: stream minutes + recent memory
resetAll();
fireEvent('playback', { type: 'start', track: { uri: 'spotify:track:aaa' }, origin: 'spotify', playedMs: 0 });
fireEvent('playback', { type: 'progress', track: { uri: 'spotify:track:aaa' }, origin: 'spotify', playedMs: 10000 });
fireEvent('playback', { type: 'progress', track: { uri: 'spotify:track:aaa' }, origin: 'spotify', playedMs: 20000 });
const day2 = store[todayKey()];
check('meter estimates streamed MB', day2 && day2.streamMb > 0.3 && day2.streamMb < 0.5, JSON.stringify(day2));
check('meter counts the streamed song', day2 && day2.streamed === 1);
fireEvent('playback', { type: 'end', reason: 'finished', track: { uri: 'spotify:track:aaa' }, origin: 'spotify' });
check('finished song is remembered for shuffle', Array.isArray(store.recent) && store.recent[0] === 'spotify:track:aaa',
  JSON.stringify(store.recent));

// 9. Home section renders with data line, buttons and shuffle picks
resetAll();
const home = callHook('home', {});
check('home returns a section', Array.isArray(home) && home[0] && home[0].type === 'section');
const homeBlocks = (home[0] && home[0].blocks) || [];
check('home has the shuffle-liked button', homeBlocks.some((b) => b.action === 'shuffle-liked'));
const picks = homeBlocks.filter((b) => b.type === 'tracks')[0];
check('home shows shuffle picks from Liked Songs', picks && picks.items && picks.items.length === 6, JSON.stringify(picks));

// 10. Player button: Mood mix when the song has a mood, Smart Shuffle when not
const playerBtn = callHook('player', moneyTrees);
check('player button is Mood mix for a rap song',
  Array.isArray(playerBtn) && playerBtn.length === 1 && playerBtn[0].action === 'mood-mix' && playerBtn[0].label === 'Mood mix · Rap',
  JSON.stringify(playerBtn));
const playerBtn2 = callHook('player', unknownTrack);
check('player button falls back to Smart Shuffle with no mood',
  Array.isArray(playerBtn2) && playerBtn2.length === 1 && playerBtn2[0].action === 'smart-shuffle' && playerBtn2[0].label === 'Smart Shuffle',
  JSON.stringify(playerBtn2));

// 11. Status: live when Archive.org answers
settings.ownLibrary = '';
const status = callHook('status', {});
check('status reports live', status && status.live === true, JSON.stringify(status));

// 12. Moods: Home has a Moods section with counts from Liked Songs
resetAll();
settings.ownLibrary = 'https://example.com/music';
const home2 = callHook('home', {});
check('home returns two sections (Lite + Moods)', Array.isArray(home2) && home2.length === 2, JSON.stringify(home2.map((s) => s.title)));
const moodSection = home2[1];
const moodButtons = (moodSection.blocks || []).filter((b) => b.type === 'button');
const moodLabels = moodButtons.map((b) => b.label);
check('mood buttons show rap 4, chill 1, nostalgia 2, party 1',
  moodLabels.indexOf('Rap · 4') >= 0 && moodLabels.indexOf('Chill · 1') >= 0 &&
  moodLabels.indexOf('Nostalgia · 2') >= 0 && moodLabels.indexOf('Party · 1') >= 0,
  JSON.stringify(moodLabels));
check('no button for a mood with no songs', moodLabels.every((l) => l.indexOf('Sleep') !== 0 && l.indexOf('Sad') !== 0));

// 13. Unstoppable: Home shows the offline-readiness count (folder matches only)
const liteText = (home2[0].blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
check('home readiness line counts folder matches', liteText.indexOf('Unstoppable: 2 of 7') >= 0, liteText);

// 14. Tap a mood: Home re-renders with that mood's songs
callHook('tap', { action: 'mood-rap' });
check('tapping a mood remembers it', store['mood.selected'] === 'rap');
const home3 = callHook('home', {});
const rapSection = home3[1];
check('mood view is titled for the mood', rapSection.title === 'Moods · Rap', rapSection.title);
const rapTracks = (rapSection.blocks || []).filter((b) => b.type === 'tracks')[0];
const rapUris = (rapTracks.items || []).map((i) => i.uri);
check('rap view lists the 4 rap songs',
  rapUris.length === 4 && rapUris.indexOf('spotify:track:aaa') >= 0 && rapUris.indexOf('spotify:track:fff') >= 0,
  JSON.stringify(rapUris));
check('rap view has a play button', (rapSection.blocks || []).some((b) => b.action === 'mood-play'));

// 15. Play the mood: only that mood's songs, each once
resetAll();
store['mood.selected'] = 'rap';
callHook('tap', { action: 'mood-play' });
check('mood play uses the Liked Songs context', playedCalls.length === 1 && playedCalls[0].ctx === 'spotify:collection:tracks',
  JSON.stringify(playedCalls));
const moodOrder = playedCalls.length ? playedCalls[0].order : [];
check('mood play has the 4 rap songs once', moodOrder.length === 4 && new Set(moodOrder).size === 4, JSON.stringify(moodOrder));
check('mood play notifies the mood', notifications.some((t) => t.indexOf('Mood mix: Rap on: 4 songs') === 0));

// 16. Mood mix from the player: more of the playing song's mood, from the list playing
resetAll();
fireEvent('playback', { type: 'start', track: { uri: 'spotify:track:aaa', title: 'Money Trees', artist: 'Kendrick Lamar' }, origin: 'spotify', playedMs: 0 });
callHook('tap', { action: 'mood-mix' });
check('mood mix plays from the current playlist', playedCalls.length === 1 && playedCalls[0].ctx === 'spotify:playlist:test123',
  JSON.stringify(playedCalls));
const mixOrder = playedCalls.length ? playedCalls[0].order : [];
check('mood mix has the 5 rap songs of the playlist once', mixOrder.length === 5 && new Set(mixOrder).size === 5, JSON.stringify(mixOrder));
check('mood mix notifies the mood', notifications.some((t) => t.indexOf('Mood mix: Rap on: 5 songs') === 0));

// 17. Ahead: the next song is resolved early and remembered for Home
resetAll();
settings.ownLibrary = 'https://example.com/music';
const aheadAns = callHook('audio-source', Object.assign({}, moneyTrees, { ahead: true }));
check('ahead call still returns the small file', aheadAns && aheadAns.url === 'https://example.com/music/money-trees.mp3', JSON.stringify(aheadAns));
check('ahead call remembers the next song', store.nextReady && store.nextReady.lite === true && store.nextReady.title === 'Money Trees',
  JSON.stringify(store.nextReady));
const aheadMiss = callHook('audio-source', Object.assign({}, unknownTrack, { ahead: true }));
check('ahead call with no file returns null', aheadMiss === null);
check('ahead miss is remembered as not lite', store.nextReady && store.nextReady.lite === false, JSON.stringify(store.nextReady));

// 18. Clear the mood: Home shows the mood buttons again
resetAll();
store['mood.selected'] = 'rap';
callHook('tap', { action: 'mood-clear' });
check('clearing a mood forgets it', store['mood.selected'] === '');
const home4 = callHook('home', {});
check('cleared mood view has buttons again', (home4[1].blocks || []).some((b) => b.action === 'mood-rap'));

// 19. Unstoppable button explains the download step
resetAll();
callHook('tap', { action: 'unstoppable' });
check('unstoppable button tells how to download', notifications.some((t) => t.indexOf('Download') >= 0), JSON.stringify(notifications));

// 20. Rename: Home says Culture, with AutoMix state and a DJ button
resetAll();
settings.automix = true;
settings.ownLibrary = 'https://example.com/music';
const home5 = callHook('home', {});
check('home section is now named Culture', home5[0].title === 'Culture — low data', home5[0].title);
const dataText = (home5[0].blocks || []).filter((b) => b.type === 'text')[0].text;
check('home says AutoMix is on', dataText.indexOf('AutoMix on') >= 0, dataText);
check('home has a DJ Culture button', (home5[0].blocks || []).some((b) => b.action === 'dj-start'));

// Energy of each stub track, by its moods: Lofi Rain chill 1, California
// Love rap+nostalgia 5, Rainy Days nostalgia 5, Party Rock party 6, the
// Kendrick/Pop Smoke songs rap 7.
const ENERGY = { 'spotify:track:aaa': 7, 'spotify:track:bbb': 7, 'spotify:track:ccc': 7, 'spotify:track:ddd': 7, 'spotify:track:eee': 1, 'spotify:track:fff': 5, 'spotify:track:ggg': 6, 'spotify:track:hhh': 5 };
function energiesNonDecreasing(order) {
  let prev = -1;
  for (let i = 0; i < order.length; i++) {
    const e = ENERGY[order[i]];
    if (e == null || e < prev) return false;
    prev = e;
  }
  return true;
}

// 21. AutoMix on: a shuffle flows calm to high energy
resetAll();
settings.automix = true;
callHook('tap', { action: 'smart-shuffle' });
const autoOrder = playedCalls.length ? playedCalls[0].order : [];
check('automix orders the shuffle calm to high energy', autoOrder.length === 8 && energiesNonDecreasing(autoOrder), JSON.stringify(autoOrder));

// 22. AutoMix off: a plain shuffle still plays every song once
resetAll();
settings.automix = false;
callHook('tap', { action: 'smart-shuffle' });
const plainOrder = playedCalls.length ? playedCalls[0].order : [];
check('automix off still plays every song once', plainOrder.length === 8 && new Set(plainOrder).size === 8, JSON.stringify(plainOrder));
settings.automix = true;

// 23. DJ Culture: a set from Liked Songs, ordered by energy
resetAll();
settings.automix = true;
callHook('tap', { action: 'dj-start' });
check('dj start plays Liked Songs', playedCalls.length === 1 && playedCalls[0].ctx === 'spotify:collection:tracks', JSON.stringify(playedCalls));
const djOrder = playedCalls.length ? playedCalls[0].order : [];
check('dj set is ordered calm to high energy', djOrder.length === 7 && energiesNonDecreasing(djOrder), JSON.stringify(djOrder));
check('dj start notifies', notifications.some((t) => t.indexOf('DJ Culture on: 7 songs') === 0));
check('dj start remembers the set', store['dj.on'] === true && Array.isArray(store['dj.queue']) && store['dj.queue'].length === 7);

// 24. DJ Culture: announces picks, ends when the user moves on or the set ends
fireEvent('playback', { type: 'start', track: { uri: 'spotify:track:eee', title: 'Lofi Rain', artist: 'Chillhop Music' }, origin: 'audio-source', playedMs: 0 });
check('dj announces the next pick', notifications.some((t) => t.indexOf('DJ Culture: now Lofi Rain — up next: ') === 0), JSON.stringify(notifications));
fireEvent('playback', { type: 'start', track: { uri: 'spotify:track:zzz', title: 'No Such Song', artist: 'Nobody' }, origin: 'spotify', playedMs: 0 });
check('dj stops when the user plays something else', store['dj.on'] === false);
resetAll();
callHook('tap', { action: 'dj-start' });
const q = store['dj.queue'];
fireEvent('playback', { type: 'start', track: { uri: q[q.length - 1].uri, title: q[q.length - 1].title }, origin: 'audio-source', playedMs: 0 });
check('dj announces the end of the set', notifications.some((t) => t.indexOf('end of the set') >= 0), JSON.stringify(notifications));
check('dj is off after the set ends', store['dj.on'] === false);
resetAll();
callHook('tap', { action: 'dj-start' });
callHook('tap', { action: 'dj-stop' });
check('dj stop turns it off', store['dj.on'] === false && Array.isArray(store['dj.queue']) && store['dj.queue'].length === 0);
check('dj stop notifies', notifications.some((t) => t.indexOf('DJ Culture off') === 0));

console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' check(s) failed.');
process.exit(failures === 0 ? 0 : 1);
