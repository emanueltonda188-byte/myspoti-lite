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
  shuffleNoRepeat: true, recentWindow: 50, dataWarningMb: 100,
};
const httpCalls = {};
const httpRoutes = [];
function mockHttp(match, handler) { httpRoutes.push({ match: match, handler: handler }); }

const likedTracks = [
  { uri: 'spotify:track:aaa', name: 'Money Trees', artists: [{ name: 'Kendrick Lamar' }], durationMs: 308000 },
  { uri: 'spotify:track:bbb', name: 'Dior', artists: [{ name: 'Pop Smoke' }], durationMs: 213000 },
  { uri: 'spotify:track:ccc', name: 'Alright', artists: [{ name: 'Kendrick Lamar' }], durationMs: 219000 },
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
  return okJson([{ isrc: 'USUM71200905', title: 'Money Trees', artist: 'Kendrick Lamar', durationMs: 308000, file: 'money-trees.mp3' }]);
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
  order.length === 4 && new Set(order).size === 4 && order.indexOf('spotify:track:aaa') >= 0);
check('smart shuffle notifies', notifications.some((t) => t.indexOf('Smart Shuffle on: 4 songs') === 0));

// 7. Smart Shuffle skips recently played songs
resetAll();
store.recent = ['spotify:track:aaa', 'spotify:track:bbb'];
callHook('tap', { action: 'smart-shuffle' });
const order2 = playedCalls.length ? playedCalls[0].order : [];
check('smart shuffle skips recent songs', order2.length === 2 && order2.indexOf('spotify:track:aaa') < 0 && order2.indexOf('spotify:track:bbb') < 0,
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
check('home shows shuffle picks from Liked Songs', picks && picks.items && picks.items.length === 3, JSON.stringify(picks));

// 10. Player button
const player = callHook('player', moneyTrees);
check('player hook adds one Smart Shuffle button',
  Array.isArray(player) && player.length === 1 && player[0].action === 'smart-shuffle' && player[0].icon === 'shuffle');

// 11. Status: live when Archive.org answers
settings.ownLibrary = '';
const status = callHook('status', {});
check('status reports live', status && status.live === true, JSON.stringify(status));

console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' check(s) failed.');
process.exit(failures === 0 ? 0 : 1);
