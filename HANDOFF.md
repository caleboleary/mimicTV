# Handoff: ErsatzTV Next scheduler + UI project

_Written 2026-09-04 from a planning conversation. Treat the "Verified" section as fact (read directly from the repo), the "Product vision" section as the owner's intent, and "Open questions" as things to resolve before building on them._

## TL;DR

ErsatzTV is splitting into **Legacy** (the existing all-in-one C# app, security-updates only) and **Next** (a Rust rewrite that *only* transcodes and streams). Next deliberately does **not** do library management, scheduling, or playout generation — it consumes pre-generated JSON timelines and the maintainer has said scheduling feature requests won't be accepted upstream.

That leaves an open niche: **a scheduler + UI that produces those JSON files.** Nothing serious exists yet. This project is that thing, with a heavy emphasis on UX — the owner finds Legacy's UI rough and unintuitive and wants something that makes channel setup pleasant and replicable.

## Context on the ecosystem

- Legacy repo: `github.com/ErsatzTV/legacy` (C#, still gets security releases, e.g. v26.8.0 in Aug 2026). Legacy has also been embedding Next's engine internally as a selectable "streaming engine."
- Next repo: `github.com/ErsatzTV/next` (Rust, MIT, ~300 commits, self-described "VERY EARLY STAGE… expect breaking changes"). Docs: `https://ersatztv.org/next-docs/`. Dev chat: Matrix `#ersatztv-dev:matrix.org`, Discord `#developer-chat`.
- Maintainer (Jason Dove) explicitly wants **early feedback on the playout schema** — building a real consumer of it is a good way to influence it. Worth announcing intent in the dev channel before investing heavily.
- The owner currently runs Legacy in an Unraid Docker container. Target deployment for this project is likely also a Docker container sitting next to Next.

## Verified facts about Next (read from the repo, 2026-09-04)

### Crates
- `ffpipeline` — transcoding/normalization
- `ersatztv-playout` — Rust models for the playout JSON schema (**use these as the source of truth**; `schema/playout.json` is the JSON Schema)
- `ersatztv-channel` — turns playout JSON into one channel's HLS stream
- `ersatztv` — HTTP server (M3U/M3U8/XMLTV), manages channel processes
- `ersatztv-playout-generator` — reference-only generator from a folder of videos; explicitly not a supported scheduler

### Config shape
- `lineup.json`: server bind/port, HLS output folder, **`xmltv.folder`**, and a `channels[]` list (number, name, path to channel.json, `tvg_id`, logo, group).
- `channel.json`: `playout.folder` (where playout JSON files live), ffmpeg paths, and normalization settings (video/audio codec, resolution, bitrate, hw accel, loudness, subtitle mode).
- Playout files live in the channel's playout folder.

### Playout JSON (schema version `https://ersatztv.org/playout/version/0.0.3`)
**A playout is a flat, timestamped list. That's the whole model.**

```json
{
  "version": "https://ersatztv.org/playout/version/0.0.3",
  "generated_at": "...",
  "items": [
    { "id": "1", "start": "RFC3339", "finish": "RFC3339", "source": { ... }, "tracks": { ... }, "graphics": [ ... ] }
  ]
}
```

- Required per item: `id` (unique within file), `start`, `finish`. Must have `source` and/or per-track `tracks.{video,audio,subtitle}.source`.
- **No notion of episode/commercial/filler/chapter/collection.** All semantics are the scheduler's job.
- **Source types:** `local` (path + optional **`in_point_ms` / `out_point_ms`**), `lavfi` (synthetic, e.g. `anullsrc` silence or test patterns), `http`, `rtsp`, `script` (any command emitting MPEG-TS to stdout, e.g. yt-dlp), and `dynamic` (see below).
- **Segments:** playing a slice of a file = a `local` source with in/out points. Mid-roll breaks between chapters are therefore just multiple items pointing at the same file with different offsets.
- **Static image filler:** the shipped example does exactly this — video track from a PNG, audio track from `lavfi anullsrc`. Per-track sources can be mixed freely.
- **Track selection:** per-item `stream_index` for video/audio/subtitle.
- **Graphics:** per-item `watermark` (legacy compat) and `graphics[]` (ordered layers). Each layer: source (image or video), 9-position anchor, size/margin/opacity percents, `within_source_content`, and optional `periodic` timing with `wall` or `content` clock (e.g. bug fades in on every wall-clock :05). Include the layer on show items and omit it on ads to get "bug off during commercials."
- **`probe_hint`:** optional pre-supplied ffprobe metadata; if present the engine skips probing. Useful if the library layer already probes everything.
- **`dynamic` source:** a placeholder resolved *at playback time* by GETting a URL that returns a `PlayoutItem`; re-hit repeatedly while playback stays inside the placeholder window. Headers include `x-etv-channel`, `x-etv-dynamic-id`, `x-etv-now`, `x-etv-until`. This allows "plan the shape of a break now, pick the actual ads live." Good future feature; not needed for v1.

### Runtime behavior (from `ersatztv-channel/src/playout_loader.rs` and `channel_session.rs`)
- **Filename is the index.** Files must be named `{start}_{finish}.json` in compact ISO 8601 (e.g. `20260413T000000.000000000-0500_20260414T002131.620000000-0500.json`). The loader scans the folder and picks the file whose filename window contains "now."
- **Re-read from disk on every item lookup.** No caching, no file watcher. Implication: write future files any time; **write atomically** (temp file + rename) so a half-written file is never read. No special "filler hour" convention is required by the engine (a third-party Claude skill claims one; ignore it).
- **Gaps don't crash the channel.** If no item covers "now," the engine synthesizes black/silence until the next item's `start` (or 1 minute if none). The scheduler should still produce a contiguous timeline.
- **XMLTV:** the lineup server builds the guide by copying `<programme>` elements *verbatim* from `{xmltv.folder}/{tvg_id}.xml`, which **the scheduler writes**. The reference generator emits only titles, but since elements are copied as-is, richer XMLTV (desc, episode-num, icon, category) should pass through. Verify with a real client.

### Running Next locally
Needs `ffmpeg`/`ffprobe` on PATH. Prebuilt binaries at the repo's `develop` release, or `cargo build --release --workspace`. Quick start: `ersatztv add-lineup config/lineup.json --channels 1`, then `ersatztv config/lineup.json`, watch `http://localhost:8409/channel/1.m3u8`. There's a `docker/` folder.

## Product vision (owner's intent)

### Principles
- **UX first.** The reason to exist is that configuring channels should be intuitive, visual, and replicable. Don't produce a generic admin dashboard.
- **Next is a dumb timeline player; we own all meaning.** Library, metadata, chapters, ordering state, scheduling logic, EPG content — all here.
- **The JSON emitter is a thin, isolated module.** Schema is 0.0.3 and will change. Nothing else in the codebase should know the output format.
- **Preview is the centerpiece.** Because output is just JSON, we can dry-run any change and render a day-long EPG strip instantly. "Show me Tuesday." Click a break to see its contents. Change a rule, watch the day re-flow. Legacy cannot do this well; we can.

### Core domain model (proposed — argue with it, then lock it)
1. **Pools** — a named set of content plus a selection rule. Examples: "Sitcoms: shuffle shows, keep each show's episodes in order"; "Commercials: 90s era, random, no repeat within 2h"; "Network IDs"; "Static/glitch clips." A pool's page always shows its items, durations, break/chapter status, and last-played. (Fixes the "I can't see what's in my collection" pain point.)
2. **Clocks** — a template for one program slot, modeled on the broadcast "format clock." Example clock: content slot targets 22 min from Pool A (accept one 22-min ep OR two 11-min eps); insert a break at every chapter marker; each break is N items from Pool B; add a network ID if the break lands within ~3 min of :00/:30, ID always last; pad to next :30 from Pool C; **equalize break lengths** so mid/post rolls are consistent. Clocks should be visual (ring or horizontal bar with slot/break segments).
3. **Channels** — a pool + a clock (or day-parted clocks: morning/primetime/overnight) + channel metadata (number, name, logo, tvg_id, normalization). Replicating a channel = duplicate, swap pool. Also emits the Next `channel.json`/`lineup.json` entries.
4. **Cursors** — persistent per-show (or per-pool) playback position so "random shows, but each show plays in order over the long term" works across regenerations. UI shows each show's cursor, allows reset/jump, and previews the next N picks.
5. **Break points / chapters** — per-episode list of candidate break timestamps, from embedded chapters, blackdetect analysis, or manual edits. Clocks consume these.

### Break-point (blackdetect) tooling — a differentiator
The owner already has working code that: runs ffmpeg blackdetect, scans a season at a time, infers the likely break pattern across episodes, commits chapters, and allows manual overrides. **Port this in; do not rewrite from scratch.** Ask the owner for the code. In the UI this lives in the library: open a season → each episode as a timeline with detected black frames → inferred pattern ("breaks at ~7:05 and ~14:30 in 22/24 eps") → accept, then drag to fix outliers.

### Specific pain points to solve (from the owner)
- Can't see the contents of manual collections in Legacy.
- No good way to add/manage chapter/break metadata.
- No builder for "22-min ep or two 11-min eps, breaks in all chapters, commercials from these pools, IDs near :00/:30 always last, fill with static image or random clip, equalize breaks."
- No easy way to replicate a channel setup.
- "Random but prefer in-order over the long term" is possible in Legacy but awkward.

### Reference material worth reading
- Legacy's **YAML sequential schedule** format (community reference: `github.com/VaultDweller39/etv-yaml-playouts`; official docs under `ersatztv.org/docs/scheduling/`). It has `content` pools, reusable `sequence` blocks, `pad_to_next`, `count`/`duration` instructions, `repeat`. Our clock concept ≈ that format + breaks/chapters as first-class + a GUI. Don't reinvent its instruction set blindly.
- Legacy's scripted-schedule OpenAPI (`/openapi/scripted-schedule.json` on a Legacy instance) — another view of the same instruction vocabulary.
- Legacy source (C#) for the actual shuffle/marathon/filler algorithms if we want parity.

## Suggested build order

1. **Schema doc.** Read `crates/ersatztv-playout/src/playout.rs` and `schema/playout.json`; write `docs/next-schema.md` in plain English. Re-verify the facts above (the repo moves).
2. **Domain model doc.** `docs/domain-model.md`: pools, clocks, channels, cursors, break points. Get owner sign-off before code.
3. **Headless engine first.** Library ingest (start with local folders + one media server, probably Jellyfin or Plex — ask), pool selection with seeded RNG, one clock type, cursor persistence, JSON + XMLTV emission, atomic file writes, N-days-ahead regeneration on a schedule. Test against a fake library. **Milestone: a real channel plays in a locally running Next.**
4. **Then UI.** Read `/mnt/skills/public/frontend-design/SKILL.md` (or the equivalent in the environment) before styling — avoid templated dashboard aesthetics. Prioritize: pool browser → clock builder → day preview strip → channel duplicate.
5. Later: `dynamic` source for live ad selection, cross-channel no-repeat, day-parting, more clock types.

## Open questions (ask the owner)
- Language/stack preference. Rust could reuse the `ersatztv-playout` crate models directly; TS/Python is faster to iterate on UI. Not yet decided.
- Media server integration priority (Plex / Jellyfin / Emby / local folders only?).
- Where the blackdetect code lives and what language it's in.
- Does richer XMLTV actually pass through to clients? (Test.)
- Single-user local tool vs. something others will deploy? Affects auth, config, packaging.

## Things not to do
- Don't send scheduling feature requests to the Next repo; this is an independent project.
- Don't let any module other than the emitter depend on the playout JSON shape.
- Don't rebuild all of Legacy. Pick the slice (pools + one clock + preview) and ship.
- Don't rewrite the owner's blackdetect logic.
