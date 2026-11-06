#!/usr/bin/env python3
"""Build an index.json for a folder of your own MP3s (MySpoti Lite).

Usage:
    python3 tools/make_index.py ~/Music --out index.json

- Reads MP3 tags (title, artist, duration, ISRC, genre, year) when `mutagen`
  is installed (`pip install mutagen`). Without it, falls back to
  "Artist - Title.mp3" file names and no duration.
- Genre maps to a mood (Hip-Hop -> rap, Lo-Fi -> chill, ...), and a year
  before 2000 adds nostalgia. The extension reads the "mood" and "year"
  fields from index.json, so a song can be tagged exactly.
- Upload index.json next to the MP3s in your web folder, then paste the
  folder URL in the extension's "Your own music folder URL" setting.
- Only list files you own the rights to share. Keep them small: encode at
  96 kbps and a 3-minute song is about 2 MB.
"""
import argparse
import json
import os
import sys

# Same map as main.js GENRE_MOODS: ID3 genre -> mood id.
GENRE_MOODS = {
    "hip hop": "rap", "hip-hop": "rap", "rap": "rap", "trap": "rap",
    "drill": "rap", "grime": "rap",
    "lo-fi": "chill", "lofi": "chill", "ambient": "chill", "chill": "chill",
    "chillout": "chill", "acoustic": "chill", "folk": "chill",
    "jazz": "chill", "reggae": "chill",
    "dance": "party", "edm": "party", "house": "party", "techno": "party",
    "party": "party", "afrobeat": "party", "afrobeats": "party",
    "classical": "focus", "piano": "focus", "instrumental": "focus",
    "study": "focus",
    "pop": "happy", "gospel": "happy",
    "soul": "love", "r&b": "love", "rnb": "love",
    "blues": "sad", "lullaby": "sleep",
    "rock": "workout", "metal": "workout",
}


def genre_to_mood(genre):
    if not genre:
        return None
    return GENRE_MOODS.get(genre.strip().lower())


def parse_filename(name):
    stem = os.path.splitext(name)[0]
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return artist.strip(), title.strip()
    return "", stem.strip()


def read_tags(path):
    try:
        from mutagen import File as MutagenFile
    except ImportError:
        return None
    try:
        audio = MutagenFile(path)
    except Exception:
        return None
    if audio is None:
        return None
    tags = audio.tags or {}
    title = artist = isrc = genre = None
    year = None
    for key in ("TIT2", "©nam", "TITLE"):
        if key in tags:
            title = str(tags[key][0])
            break
    for key in ("TPE1", "©ART", "ARTIST"):
        if key in tags:
            artist = str(tags[key][0])
            break
    for key in ("TSRC", "ISRC"):
        if key in tags:
            isrc = str(tags[key][0])
            break
    for key in ("TCON", "©gen", "GENRE"):
        if key in tags:
            genre = str(tags[key][0])
            break
    for key in ("TDRC", "TDAT", "TYER", "©day", "YEAR", "DATE"):
        if key in tags:
            try:
                year = int(str(tags[key][0])[:4])
            except (ValueError, TypeError):
                year = None
            break
    duration_ms = None
    info = getattr(audio, "info", None)
    if info is not None and getattr(info, "length", None):
        duration_ms = int(round(info.length * 1000))
    return {"title": title, "artist": artist, "isrc": isrc, "duration_ms": duration_ms,
            "genre": genre, "year": year}


def main():
    parser = argparse.ArgumentParser(description="Build index.json for MySpoti Lite")
    parser.add_argument("folder", help="Folder of MP3s")
    parser.add_argument("--out", default="index.json", help="Output file (default: index.json)")
    args = parser.parse_args()

    entries = []
    for name in sorted(os.listdir(args.folder)):
        if not name.lower().endswith(".mp3"):
            continue
        path = os.path.join(args.folder, name)
        if not os.path.isfile(path):
            continue
        artist, title = parse_filename(name)
        duration_ms = None
        isrc = None
        genre = None
        year = None
        tags = read_tags(path)
        if tags:
            title = tags["title"] or title
            artist = tags["artist"] or artist
            isrc = tags["isrc"]
            duration_ms = tags["duration_ms"]
            genre = tags["genre"]
            year = tags["year"]
        entry = {"title": title, "artist": artist, "file": name}
        if duration_ms:
            entry["durationMs"] = duration_ms
        if isrc:
            entry["isrc"] = isrc
        mood = genre_to_mood(genre)
        if year:
            entry["year"] = year
            if year < 2000:
                entry["mood"] = [mood, "nostalgia"] if mood else "nostalgia"
            elif mood:
                entry["mood"] = mood
        elif mood:
            entry["mood"] = mood
        entries.append(entry)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {len(entries)} entries to {args.out}")
    if not entries:
        print("No MP3s found in that folder.", file=sys.stderr)


if __name__ == "__main__":
    main()
