# Development

Node 22+ and `ffmpeg`/`ffprobe` on PATH.

```sh
npm install
npm run dev        # app on http://localhost:5173 (Vite, live reload), service on :8787 (restarts on change)
npm test           # engine, publish, break-planning tests
npm run typecheck
npm run build      # apps/web/dist; the service serves it when present, so `npm start` alone runs everything
```

State lives in `data/` (ignored by git); set `MIMICTV_DATA` to keep it elsewhere.

## Layout

- `packages/core`: the domain model, the deterministic scheduling engine, break-point planning, and the emitter for ErsatzTV Next's playout JSON and XMLTV. Pure; no I/O. Nothing outside `emit/` knows the playout format.
- `apps/server`: the service. Plain `node:http`. Scans with ffprobe, measures breaks with ffmpeg, keeps JSON state, publishes on a schedule, resolves live breaks, serves the built app.
- `apps/web`: React + Vite. Guide, Channels, Library, Setup, Help.
- `docs/`: [recipes](recipes.md), [domain model](domain-model.md), [ErsatzTV Next schema notes](next-schema.md), [break points](breaks.md), [Docker install](docker.md).

## Developing on the box that has the media

`docker-compose.dev.yml` runs this checkout bind-mounted in a container with Node and ffmpeg, so the app sees the
real library and the real ErsatzTV Next. Edit the paths, then `docker compose -f docker-compose.dev.yml up -d`.
Edits are picked up live; commit from inside or outside the container as you like.
