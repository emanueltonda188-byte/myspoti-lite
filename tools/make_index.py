#!/usr/bin/env python3
"""Build an index.json for a folder of your own MP3s (MySpoti Lite).

Usage:
    python3 tools/make_index.py ~/Music --out index.json

- Reads MP3 tags (title, artist, duration, ISRC) when `mutagen` is installed
  (`pip install mutagen`). Without it, falls back to "Artist - Title.mp3"
  file names and no duration.
- Upload index.json next to the MP3s in your web folder, then paste the
  folder URL in the extension's "Your own music folder URL" setting.
- Only list files you own the rights to share. Keep them small: encode at
  96 kbps and a 3-minute song is about 2 MB.
"""
import argparse
import json
import os
import sys


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
    title = artist = isrc = None
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
    duration_ms = None
    info = getattr(audio, "info", None)
    if info is not None and getattr(info, "length", None):
        duration_ms = int(round(info.length * 1000))
    return {"title": title, "artist": artist, "isrc": isrc, "duration_ms": duration_ms}


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
        tags = read_tags(path)
        if tags:
            title = tags["title"] or title
            artist = tags["artist"] or artist
            isrc = tags["isrc"]
            duration_ms = tags["duration_ms"]
        entry = {"title": title, "artist": artist, "file": name}
        if duration_ms:
            entry["durationMs"] = duration_ms
        if isrc:
            entry["isrc"] = isrc
        entries.append(entry)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {len(entries)} entries to {args.out}")
    if not entries:
        print("No MP3s found in that folder.", file=sys.stderr)


if __name__ == "__main__":
    main()
