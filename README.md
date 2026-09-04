# mimicTV

A scheduler and UI that produces playout timelines for [ErsatzTV Next](https://github.com/ErsatzTV/next). Next transcodes and streams; mimicTV decides what plays when, and makes setting that up pleasant.

**Status: proof of concept.** Runs entirely in the browser against a stub library. No ingest, no file writing yet.

## What's here

- `packages/core`: the domain model, a deterministic scheduling engine (pools, clocks, cursors, break equalization, network-ID placement, padding to the half hour), and an isolated emitter for Next's playout JSON and XMLTV. Tested with vitest, including validation against Next's 0.0.3 JSON schema.
- `apps/web`: React + Vite. Day preview with an inspector, a visual clock builder that re-flows the day live, a pool browser with cursors and last-played, and channel cards with duplicate and export.
- `docs/`: [domain model](docs/domain-model.md) and [Next schema notes](docs/next-schema.md).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests
npm run typecheck
```

Rules you edit persist in localStorage. "Reset to defaults" in the sidebar clears them.

## Use your real library's shape

On the machine that has the media (needs `ffprobe`):

```sh
./scripts/probe-library.sh -o library.jsonl /mnt/user/media/tv /mnt/user/media/commercials /mnt/user/media/ids
```

It writes one JSON line per file: path, duration, chapters, and stream info. Nothing else leaves the box. Useful flags: `-n 50` for a quick test, `-r` to resume an interrupted run, `-j` to gzip the result. If ffprobe only exists inside a container, point at it with `FFPROBE="docker exec -i ersatztv ffprobe"` and pass container paths.

Getting the file back is easiest with the receiver. On this machine, from the repo root:

```sh
python3 scripts/receive.py
```

It prints the exact command to paste on the media box, which downloads the script from here, scans, and uploads the result into `data/imports/`. The Library page lists everything in that folder under "Received files". If you'd rather move the file by hand, the file picker on the same page works too.

Open the Library page and load the file. Kinds are guessed from folder names (tv, commercials, ids, filler, movies) and can be overridden per root. "Generate starter pools, clocks, channels" builds one channel per program root so the preview lights up immediately. The imported library persists in IndexedDB; "Back to stub library" restores the fake one.
