<p align="center"><img src="mimictv.png" alt="mimicTV: a mimic disguised as a CRT television, tongue wrapped around a remote" width="220"></p>

# mimicTV

A scheduler and UI that produces playout timelines for [ErsatzTV Next](https://github.com/ErsatzTV/next). Next transcodes and streams; mimicTV decides what plays when, and makes setting that up pleasant.

**Status: early, but end to end.** The engine and preview run in the browser; a small Node service scans your media with ffprobe, keeps state on disk, and writes Next's files on a schedule.

## What's here

- `packages/core`: the domain model, a deterministic scheduling engine (pools, clocks, cursors, break equalization, network-ID placement, padding to the half hour), and an isolated emitter for Next's playout JSON and XMLTV. Tested with vitest, including validation against Next's 0.0.3 JSON schema.
- `apps/web`: React + Vite. Four tabs. **Guide** shows every channel for a day side by side like an EPG. **Channels** is where a channel is made on one screen: shows, format, breaks, and schedule on the left, the live day preview and inspector on the right. **Library** holds the media, per-show chapter coverage, shared collections, and import. **Setup** points the service at your media folders and at Next's folder.
- `apps/server`: the service (plain `node:http`, no framework). Holds rules, library, and settings as JSON under `data/`; scans folders with ffprobe; publishes to Next; resolves live ad breaks.
- `docs/`: [domain model](docs/domain-model.md) and [Next schema notes](docs/next-schema.md).

## Run it

```sh
npm install
npm run dev        # app on http://localhost:5173, service on :8787
npm test           # engine + publish tests, one per scenario in docs/design-notes.md
npm run typecheck
```

Everything you build is saved by the service to `data/rules.json` and `data/library.json` (atomic writes), with a copy in the browser as a fallback. "Reset to defaults" in the sidebar clears it all. Set `MIMICTV_DATA` to keep state elsewhere, e.g. a Docker volume.

## Point it at your media and at Next

Open **Setup**.

1. **Where your media is.** Add your top-level folders (TV, commercials, bumpers, IDs, filler) and press **Scan now**. The service runs ffprobe over them, keeps durations, chapters, and stream facts, and builds the library. Rescan whenever files change; channels keep their settings. If ffprobe only exists in a container, set the command to `docker exec -i ersatztv ffprobe` and use container paths.
2. **Where Next reads from.** Set the output folder and press **Publish now**. mimicTV writes `lineup.json`, `channels/<id>/channel.json` with a `playout/` folder of day files, and `xmltv/<tvg_id>.xml`. Point Next at that `lineup.json`. If Next sees the files at a different path than the scan did, add a path mapping.

### How publishing works

Next reads the playout folder and picks the file whose name covers "now", re-reading on every lookup, so mimicTV writes every file atomically and keeps a few days ahead (default 3), topping up every few hours. Each channel has a **checkpoint**: cursor state at a moment, plus the rules in force then. Replaying those rules is deterministic, so a republish reproduces what was already written up to the first break after now, then continues with the current rules. Editing a channel therefore changes its future from the next break and never the item that's playing. Untouched channels reproduce their old timeline exactly.

Channels flagged "pick ads at playback" write each break as a Next `dynamic` placeholder that calls back to `/dynamic/<channel>` on the service, which picks an ad on the spot.

Storage is JSON on disk on purpose: small, readable, diffable, easy to back up. A play-history database (Node's built-in SQLite) is the natural next step once "when did this ad last air anywhere" becomes a question worth asking.

Pools and formats belong to the channel that made them. "Make reusable" on a pool turns it into a shared collection other channels can pick; "Make a private copy" goes the other way. See `docs/design-notes.md` for why.

## Scan from another machine instead

On the machine that has the media (needs `ffprobe`):

```sh
./scripts/probe-library.sh -o library.jsonl /mnt/user/media/tv /mnt/user/media/commercials /mnt/user/media/ids
```

It writes one JSON line per file: path, duration, chapters, and stream info. Nothing else leaves the box. Useful flags: `-n 50` for a quick test, `-r` to resume an interrupted run, `-j` to gzip the result, `-u http://<mimictv-host>:8787/imports/upload` to send the result straight to the service. The Library page lists everything in `data/imports/` under "Received files"; the file picker on the same page works too. `scripts/receive.py` is an older standalone receiver that still works.

Open the Library page and load the file. Kinds are guessed from folder names (tv, commercials, ids, filler, movies) and can be overridden per root. "Generate starter pools, clocks, channels" builds one channel per program root so the preview lights up immediately. The imported library persists in IndexedDB; "Back to stub library" restores the fake one.
