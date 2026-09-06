<p align="center"><img src="mimictv.png" alt="mimicTV: a mimic disguised as a CRT television, tongue wrapped around a remote" width="220"></p>

# mimicTV

> **🚧 WIP.** This is an early, actively changing project. It has not yet played a single frame through a real ErsatzTV Next instance. Expect breaking changes, rough edges, and a scheduler that is confidently wrong in new and interesting ways. Not ready for anyone but the curious.


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

Everything you build is saved by the service to `data/rules.json` and `data/library.json` (atomic writes), with a copy in the browser as a fallback. Set `MIMICTV_DATA` to keep state elsewhere, e.g. a Docker volume.

## Point it at your media and at Next

Open **Setup**.

1. **Where your media is.** Add your top-level folders (TV, commercials, bumpers, IDs, filler) and press **Scan now**. The service runs ffprobe over them, keeps durations, chapters, and stream facts, and builds the library. Rescan whenever files change; channels keep their settings. If ffprobe only exists in a container, set the command to `docker exec -i ersatztv ffprobe` and use container paths.
2. **Where Next reads from.** Set the output folder and press **Publish now**. mimicTV writes `lineup.json`, `channels/<id>/channel.json` with a `playout/` folder of day files, and `xmltv/<tvg_id>.xml`. Point Next at that `lineup.json`. If Next sees the files at a different path than the scan did, add a path mapping.
3. **Where Next is on your network**, e.g. `http://192.168.1.10:8410`. The sidebar then offers the M3U and XMLTV links for a TV app (Next serves both), and ▶ next to a channel on the Guide plays it right in the app.

### How publishing works

Next reads the playout folder and picks the file whose name covers "now", re-reading on every lookup, so mimicTV writes every file atomically and keeps a few days ahead (default 3), topping up every few hours. Each channel has a **checkpoint**: cursor state at a moment, plus the rules in force then. Replaying those rules is deterministic, so a republish reproduces what was already written up to the first break after now, then continues with the current rules. Editing a channel therefore changes its future from the next break and never the item that's playing. Untouched channels reproduce their old timeline exactly.

The service also keeps the blocks behind those files in `data/timeline/<channel>.json` and serves them with the checkpoints at `/api/published`. The app previews from that, not from scratch: what was published stays put up to the next boundary and the current rules take over from there, so the Guide shows what Next is actually playing and an edit visibly re-flows from the next break.

Channels flagged "pick ads at playback" write each break as a Next `dynamic` placeholder that calls back to `/dynamic/<channel>` on the service, which picks an ad on the spot.

Storage is JSON on disk on purpose: small, readable, diffable, easy to back up. A play-history database (Node's built-in SQLite) is the natural next step once "when did this ad last air anywhere" becomes a question worth asking.

Pools and formats belong to the channel that made them. "Make reusable" on a pool turns it into a shared collection other channels can pick; "Make a private copy" goes the other way. See `docs/design-notes.md` for why.

## Media on another machine

If mimicTV can't see the media itself, run the probe on the box that has it (needs `ffprobe`) and send the result to the service:

```sh
./scripts/probe-library.sh -u http://<mimictv-host>:8787/imports/upload /mnt/user/Media/TV /mnt/user/Media/Commercials
```

It reads paths, durations, chapters, and stream facts; nothing else leaves the box. The service builds the library from it on arrival, exactly as a scan would. Paths must be what ErsatzTV Next will see, or add a path mapping in Setup. `-n 50` probes a sample first; `-r` resumes; `-j` gzips.
