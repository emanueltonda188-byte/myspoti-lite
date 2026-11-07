# Culture

A [Myspoti](https://github.com/kota-zo/myspoti) extension for low-data listening: small audio first, unstoppable playback, small downloads for offline, a data meter, a true no-repeat Smart Shuffle, Moods, AutoMix, and DJ Culture.

> The repo is still `myspoti-lite`, so the install address does not change. Only the extension's name changed, to **Culture** (v1.2.0). The extension id is unchanged, so updating keeps working.
>
> 1.2.1 fixes the install — the welcome steps are now 5, the most Myspoti accepts (1.2.0 had 6 and refused to install).

## What it does

- **Small audio first.** When a small file of the song exists — in your own music folder, or as a free legal copy on Archive.org — it plays that instead of the full Spotify stream. A 3-minute song at ~96 kbps is about 2 MB instead of 4–5 MB. When no small file exists, it steps aside and Spotify streams as usual.
- **Unstoppable.** Myspoti asks for the next song 10 s after the one before starts, and the extension resolves its small file right then, so the next song starts at once — on Wi-Fi Myspoti also pre-reads the first 512 KB of it. A small file is only ~2 MB, so it buffers fully in seconds, and a data drop mid-song does not stop it. Home shows how many of your Liked Songs have a small file, and the **Make it unstoppable** button tells you how to download the list: downloaded songs play with data fully off.
- **Moods.** Rap, Chill, Nostalgia, Party, Workout, Focus, Sleep, Happy, Sad and Love. Home has a Moods section: tap one and it shows all its songs from your Liked Songs, with a button to play them shuffled. In the player, the Smart Shuffle button becomes **Mood mix** when the song playing has a mood — it plays more of that mood from whatever playlist, album or Liked Songs is playing. Moods are guessed from artist, title, album, genre and year (a song before 2000 is nostalgia); your own music folder can tag a song's mood exactly (below).
- **AutoMix (on by default).** Shuffles flow like a DJ set instead of jumping around at random: calm songs first (Sleep, Chill, Focus), building through Love, Happy and Nostalgia to Party, Rap and Workout, shuffled inside each step. It applies to Smart Shuffle, Mood mix and DJ Culture. Turn it off in the extension settings for a plain random shuffle.
- **DJ Culture.** A DJ set from your Liked Songs: tap **Start DJ Culture set** on Home and it plays the whole list ordered by energy, calm first building to a peak, and announces each pick in a short note — "DJ Culture: now X — up next: Y". The set ends when the queue runs out, or when you play something outside it. Tap **Stop DJ Culture** to end it early.
- **Offline.** The same small files can be downloaded (pick **Small** quality in Myspoti → Downloads) and then play with no data at all. Downloads are encrypted and kept by Myspoti, like any other download.
- **Data meter.** Estimates today's data use (streams vs lite files) on Home, and warns once a day when you pass your limit. The numbers are estimates, not a meter reading from Android.
- **Smart Shuffle.** A **Smart Shuffle** button in the player shuffles the current playlist, album, artist top tracks or Liked Songs with a real shuffle, skipping songs you played recently, so nothing repeats until every song has played once. Home also has a **Smart Shuffle Liked Songs** button and a few shuffle picks.

## Honest limits — read this first

- **It cannot download Spotify's own streams.** Spotify audio is locked (DRM). Only files from your own folder or free catalogues go offline. If a song has no small file anywhere, it still needs data to stream.
- **It cannot force Spotify's stream to a lower bitrate.** For streams, the real data saver is Myspoti itself: turn on **Data Saver** and set quality to **Low** in Myspoti → Settings → Playback (see setup below).
- **It cannot make a Spotify stream unstoppable.** A song with no small file still streams, and a stream can stall when the data dies. The fix is a small file for that song (your folder) or a downloaded list — the extension can only make unstoppable the songs it has a small file for.
- **Moods are guesses.** They come from artist, title, album, genre and year, so a song can land in the wrong mood or in none at all. Your folder's `index.json` can set a song's mood exactly with a `"mood"` field (below), and `make_index.py` writes it from the MP3's genre tag.
- **DJ Culture has no voice.** Myspoti extensions can only show short text notes, so the DJ talks through those ("now X — up next: Y"). The smooth blend between songs is Myspoti's own crossfade — turn it on in Myspoti → Settings → Playback for the full mix feeling.
- **Myspoti blocks ads, which is against Spotify's Terms of Use.** Spotify may suspend accounts that do it. That is Myspoti's own warning, not mine — use it at your own risk.
- **Archive.org matches are rare** for new commercial songs. It is a bonus for older, live and public-domain recordings, not the main source. Your own folder is the main source.

## Install

In Myspoti: **Settings → Extensions → Install from an address**, paste this repo address, and install:

```
https://github.com/emanueltonda188-byte/myspoti-lite
```

Or install the `extension.zip` from the [latest release](../../releases/latest). The install screen lists everything the extension can do — read it, tick the box, install.

## Setup (do this once)

1. **Put it first.** Settings → Playback → audio sources: move **MySpoti Lite** above Spotify, so it is asked first. Same in Settings → Downloads for the download source.
2. **Small downloads.** Settings → Downloads → quality: **Small**. Small files are re-encoded to small AAC on the phone, so they take the least space and data.
3. **Low streams.** Settings → Playback → quality: **Low**, and turn on **Data Saver**. This is what makes Spotify's own streams use less data — the extension cannot do that part.
4. **Optional: your own music folder** (below). Without it, the extension only finds the occasional free copy.

## Your own music folder (the offline source)

If you have MP3s of your own — your own recordings, songs you own as files — put them in a web folder with an `index.json` next to them, then paste the folder URL in the extension's settings (**Your own music folder URL**). A free way to host it: a public GitHub repo with GitHub Pages on.

`index.json` — one entry per file:

```json
[
  { "isrc": "USUM71200905", "title": "Money Trees", "artist": "Kendrick Lamar", "durationMs": 308000, "file": "money-trees.mp3", "mood": "rap", "year": 2012 },
  { "title": "Dior", "artist": "Pop Smoke", "durationMs": 213000, "file": "dior.mp3", "mood": ["rap", "party"] }
]
```

- `isrc` is best (exact match). Without it, title + artist must match exactly, and `durationMs` must be within 3 seconds when present.
- `mood` is one mood id, or a list of them: `rap`, `chill`, `nostalgia`, `party`, `workout`, `focus`, `sleep`, `happy`, `sad`, `love`. A `year` before 2000 also counts as nostalgia.
- `file` is the file name in the same folder. Keep the files small — encode at 96 kbps MP3 and a 3-minute song is ~2 MB.
- Make the index with the helper: `python3 tools/make_index.py ~/Music --out index.json` (reads MP3 tags when `mutagen` is installed, otherwise uses `Artist - Title.mp3` file names). It writes `mood` from the genre tag (Hip-Hop → rap, Lo-Fi → chill, ...) and `year` from the date tag.

## Settings

| Setting | What it does |
|---|---|
| Lite quality (per network) | Smallest: prefer the small file, including free copies. Balanced: your folder only, no Archive.org lookup. Best: step aside, let Spotify play full quality. Set it per network — Smallest on mobile data, Best on Wi-Fi, for example. |
| Your own music folder URL | Where your `index.json` + MP3s live. Empty = no own folder. |
| Try free copies too | Also look on Archive.org when your folder has nothing. |
| Smart Shuffle: no repeats | Skip recently played songs until the whole list played once. |
| Songs to remember | How many recently played songs shuffle avoids (default 50). |
| Warn me after (MB per day) | Daily data warning level (default 100 MB). |

## Data estimates

The meter estimates Spotify streams at 160 kbps (~1.2 MB per minute) and lite files at 96 kbps (~0.7 MB per minute). Real use varies with the quality you picked in Myspoti. Downloads are counted when they start.

## For developers

This is a standard Myspoti extension (API v1): `manifest.json` + `main.js`, packaged as a zip. Validate and test with the `myspoti-ext` tool from the Myspoti repo:

```
./gradlew :extensions-cli:installDist
myspoti-ext check ./myspoti-lite
myspoti-ext test ./myspoti-lite --scenario test/scenario-no-match.json
myspoti-ext test ./myspoti-lite --scenario test/scenario-own-library.json
myspoti-ext pack ./myspoti-lite
```

`test/harness.js` is a second check that runs the hooks against a stubbed `myspoti` object in Node, no phone needed: `node test/harness.js`.

## License

MIT. Not affiliated with or endorsed by Spotify or Myspoti.
