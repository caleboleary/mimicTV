# ErsatzTV Next playout schema, as consumed by mimicTV

Verified against `github.com/ErsatzTV/next` on 2026-09-04. Schema `https://ersatztv.org/playout/version/0.0.3`; a copy lives in `packages/core/schema/playout-0.0.3.json` and the emitter's output is validated against it in tests.

## The model

A playout is a flat list of timestamped items. Each item has `id`, RFC3339 `start` and `finish`, and a `source` and/or per-track `tracks.{video,audio,subtitle}.source`. There are no episode, break, or filler concepts; those are ours.

## Sources we emit

- `local` with optional `in_point_ms` / `out_point_ms`. A program cut into three parts at its chapter marks is three items pointing at the same file with different offsets.
- `lavfi` for synthesized audio (`anullsrc`) and, as a last resort, black video (`color=c=black`).
- A still image is a `local` video track plus a `lavfi` silence audio track. This is the shipped example's "be right back" pattern.

Not used yet: `http`, `rtsp`, `script`, `dynamic`, `probe_hint`.

## Graphics

`graphics[]` layers per item. We emit one bottom-right layer for the channel bug on program items and omit it on break items, which is how "bug off during commercials" works.

## Files

Named `{start}_{finish}.json` in compact ISO 8601 with nanoseconds and offset, e.g. `20260902T060000.000000000-0500_20260903T060000.000000000-0500.json`. The channel picks the file whose window contains "now" and re-reads it on every lookup, so writes must be atomic (temp file + rename). Gaps are tolerated (black is synthesized) but we never emit them.

## XMLTV

The lineup server copies `<programme>` elements verbatim from `{xmltv.folder}/{tvg_id}.xml`. Its copier handles nested children and entities, so `sub-title`, `desc`, `category`, and `episode-num` should pass through. Still to verify against a real client.

## Config we generate

`lineup.json` (`channels[]` with number, name, config path, `tvg_id`, logo, group) and per-channel `channel.json` (playout folder, ffmpeg paths, normalization). The Channels page shows the lineup snippet; `channel.json` generation is a later step.
