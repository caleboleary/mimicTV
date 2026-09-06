# Domain model

mimicTV owns all scheduling meaning. ErsatzTV Next is a timeline player; it never sees these concepts. Only `packages/core/src/emit/` knows the playout JSON shape.

## Library

`Show` and `MediaItem`. An item has a kind (`episode`, `movie`, `commercial`, `network-id`, `bumper`, `filler`), a duration, tags, and a list of **break points** (ms offsets) with a provenance (`chapters`, `blackdetect`, `manual`, `none`). Filler can be `trimmable` (cut to any length) and `still` (an image whose audio is synthesized silence).

The POC uses a deterministic stub library. Real ingest (local folders + ffprobe, then media servers) replaces `buildStubLibrary()` without touching the engine.

## Pools

A named filter over the library plus a **selection mode**:

| Mode | Behaviour | Cursor |
|---|---|---|
| `shows-shuffled-episodes-in-order` | pick a show at random (not the one just played), play its next episode | per show |
| `sequential` | walk the pool in order | per pool |
| `random` | uniform, avoiding anything played within `noRepeatMs` | last-played map |
| `shuffle` | always pick among the least recently played | last-played map |

## Clocks

The format for one program slot. A clock says:

- **Program**: which pool, the content target (22 min), a tolerance, and whether to stack programs to reach the target (two 11-minute cartoons).
- **Breaks**: cut programs at their break points and insert a mid-roll at each cut. Fill from a commercial pool. Either **equalize** every break in the block, or give mid-rolls a fixed target and let the post-roll absorb the rest.
- **Network ID**: when a break ends within `windowMs` of a boundary (`:00`, `:30`), pick an ID and play it **last**.
- **Bumpers** (optional): a "coming up next" pool that plays right after a program ends, a pool that opens every break, and a pool that closes every break after the ID. They come out of the break's time.
- **Overrides** (optional): while certain shows are on, draw commercials from a different pool.
- **Pad**: every block ends on the next multiple of `toMinutes`. The gap after commercials is filled from a filler pool. Trimmable filler guarantees an exact landing; the engine falls back to synthesized black if nothing fits.
- **Bug**: optional channel logo shown on programs, hidden during breaks.

A block is one instance of a clock: programs, segments, breaks, and the entries laid out contiguously. Blocks always end on a boundary, so the block sequence is the day.

## Channels

Number, name, `tvg_id`, logo, group, and **dayparts**: a sorted list of (minute-of-day, clock). The last daypart wraps past midnight. A daypart with an `endMinute` is a **fixed show**: it takes over for exactly that window every day and the base band resumes after. The engine treats its start and end as hard stops, so the block before it picks programs that fit and pads the remainder rather than running over. A channel also carries an **anchor** (when its timeline began) and a **seed**. Duplicating a channel copies everything and gives it a new seed.

## Cursors

`CursorState` is everything needed to resume a channel exactly: per-show next-episode indices, per-pool sequential indices, a last-played map, the last show, and the PRNG state. `simulate(channel, ruleset, until, prior?)` advances from the anchor or from a prior state. Same rules and seed produce the same timeline, so every preview is a dry run of what Next will play.

## Timeline

`TimelineEntry` is the unit the emitter consumes: absolute start/end, the item, its role, in/out points, and a `reason` string explaining the placement. Entries are contiguous by construction; the engine never leaves a gap.

## Deferred

- Break-point detection (owner's blackdetect code, to be ported).
- `dynamic` sources for live ad selection.
- Cross-channel no-repeat.
- Movie clocks, marathons, more selection modes.
