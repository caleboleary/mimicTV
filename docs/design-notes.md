# Design notes: scenarios and object model

_2026-09-04, status column updated 2026-09-05. A thinking pass, not a spec. Argue with it._

## 1. Scenarios people will want

Checked against the engine as of today. "Yes" means it works now with the current UI; "awkward" means possible but you'd have to know the trick; "no" names the missing piece.

| # | Scenario | Today | Missing piece |
|---|---|---|---|
| 1 | Cartoon block: shuffle shows, episodes in order, 22-min slots, breaks at chapters, IDs near :00/:30, pad to :30 | yes | |
| 2 | One-show marathon channel, in order, hour slots | yes | |
| 3 | Two shows strictly alternating | yes (a 2-show shuffle never repeats the last show) | |
| 4 | Dayparts: cartoons morning, sitcoms evening, movies late | yes | |
| 5 | Replicate a channel, swap the shows | yes | |
| 6 | Channel bug on shows, off during breaks | yes | |
| 7 | Off-air overnight: static or test pattern only | awkward | a clock with no program pool works, but "no ads" needs the pool select set to none by hand |
| 8 | Sitcoms back to back, no ads, no padding (streaming feel) | yes | "Back to back" preset; pad to 0 = block ends when content ends (2026-09-05) |
| 9 | Movie channel with a break every ~25 min | yes | Format: fallback breaks every N min or at fixed offsets when an episode has no chapters (2026-09-05) |
| 10 | Two episodes of the same show, then switch | yes | "Episodes of a show in a row" on the Shows card (2026-09-05) |
| 11 | Only seasons 1 to 3 of a show | yes | season range under Shows > More options (2026-09-05) |
| 12 | Music videos with a bumper every 4 clips | yes | "Music videos" preset; break after every N stacked programs (2026-09-05) |
| 13 | Bumper out before every break, bumper in after | no | break template: ordered slots (bumper, ads, filler, ID, bumper) |
| 14 | "Coming up next" bumper at the end of every program | no | program pre/post-roll slots (same mechanism as 13) |
| 15 | Ads themed to the era of the show playing | half | a channel-wide era pool works via saved searches (text + folder, OR rows); per-show override of the commercial pool is still missing |
| 16 | The Simpsons at 6pm every day, whatever else is going on | yes | fixed shows: a band with an end time; blocks around it are clamped (2026-09-06) |
| 17 | Saturday-morning-only cartoons | no | day-of-week on bands; fixed shows already carry the band object this hangs off |
| 18 | Holiday specials only in December | no | date windows on pools |
| 19 | East and West feeds: same channel, shifted 3h | no | channel time offset; cheap once wanted |
| 20 | Reset a show's cursor, or jump to S03E01 | no (visible, not editable) | cursor editing UI |
| 21 | Cross-channel no-repeat for commercials | no | shared last-played across channels |
| 22 | Live ad selection at playback | no | Next's `dynamic` source; already designed for in the emitter split |

**Where the gaps cluster.** Rows 8 to 12 were small engine options and all landed 2026-09-05. Rows 13 to 16 all say the same thing: a clock is currently exactly "one program slot plus breaks", and people will want a *sequence* of slots with more control over what surrounds them. Rows 17 to 19 are calendar features on the channel. Row 20 is pure UI.

## 2. The object model

### What exists

Library, Pool, Clock, Channel, Cursors. Five tabs. To make one channel you visit Pools three or four times, Clocks once, Channels once, then Preview. That's the ErsatzTV problem again, and it's structural: pools and clocks are top-level entities, so the UI forces you to create them before the thing you actually wanted.

### What's real vs. what's incidental

Ask which objects a user actually thinks about.

- **Channel.** Yes. The thing they're making.
- **Library** and its **shows**. Yes. What they have.
- **A set of shows and how to pick from them.** Real, but it's almost always *this channel's* shows. Sharing is the exception (a "90s commercials" set, used everywhere).
- **A format**, meaning slot length, break rules, padding. Real, but almost never shared. People copy a format, they don't reference one.
- **Cursors.** Real state, but it belongs to a channel. Nobody wants a Cursors tab.

So two of the five are entities the user was forced to promote. Pools are half-shared, clocks are barely shared at all.

### Proposal: channel-centric, with sharing by promotion

**One screen makes a channel.** The channel page has the recipe on the left and the live day preview on the right, always. The recipe is five sections, each editable inline:

1. **Shows.** Pick shows, pick the order rule. This *is* the program pool, created inline and owned by the channel.
2. **Format.** Slot length, pad-to, breaks at chapters / every N min / none, equalize, max ads. This *is* the clock. Not an entity; a value on the daypart.
3. **Breaks.** Commercials, IDs, filler. Each is a picker with "use shared" or "make one here".
4. **Schedule.** Defaults to "all day". "Add a time band" reveals dayparts, and later day-of-week.
5. **Identity.** Number, name, logo, tvg_id.

Sensible defaults fill everything except shows, so the shortest path is: New channel, pick five shows, done. Thirty seconds, one screen, and you're watching the preview re-flow as you tick shows.

**Sharing by promotion.** Any inline pool has a "make reusable" action that turns it into a shared collection other channels can pick. Editing a shared one warns how many channels use it. Formats get "save as preset" and "copy from channel". This gives the power user the reuse they want without making everyone pay for it up front.

**Tabs become three.**

- **Guide.** All channels for a day, stacked, like a real EPG. This is the view nobody else has, and it's where cross-channel questions (row 21) will live.
- **Channels.** List, then the one-screen editor above.
- **Library.** Items, shows, chapter status and the blackdetect tooling, plus shared collections as a side list. Import lives here.

### What this does to the engine

Almost nothing, which is the point. Pools and clocks stay as they are in `packages/core`; only their ownership changes (a channel owns some, the library owns the shared ones). The one engine change worth making with this is to generalize a clock from "one program slot" to "a list of slots", which is what rows 13 to 16 need anyway. A today-style clock is a one-slot list, so nothing existing breaks.

### Keeping it simple

Rule from the owner (2026-09-05): the shortest path must never get longer. New channel, pick shows, done. Every engine option added since goes behind a preset, a disclosure, or a default, and never adds a visible control to the default path. Prefer one plain-language choice over three numbers. Look for controls to fold or remove, not only to add.

### Naming

"Pool" vs "Collection": Legacy users know "collection", but Legacy's collections have no selection rule, and ours do. Keep "pool" in code. In the UI, the shows section doesn't need a noun at all.

## 3. Suggested order

1. ~~Restructure the UI to channel-centric with inline pools and formats.~~ Done 2026-09-04.
2. ~~Close the small engine gaps (rows 8 to 12).~~ Done 2026-09-05, behind presets and disclosures so the default path didn't grow.
3. ~~Slot lists (rows 13 to 16)~~ Replaced by three small features: fixed shows (16, done 2026-09-06), bumpers as a break recipe (13, 14), per-show ad override (15b). Then calendar (17 to 19), then cursor editing (20).
4. ~~Guide view once there are two or more channels.~~ Done 2026-09-04; cross-channel no-repeat (21) still belongs there.

## 4. Done since

- 2026-09-06: row 16 closed as **fixed shows**. Decision: no generic slot-list clock. Rows 13/14 become a break recipe (optional bumper parts), 15b a per-show ad override, 16 an appointment band. Each is one hidden entry point, none touches the default path. See "Keeping it simple".
- 2026-09-05 (later): rows 8, 10, 11, 12 closed in the engine (pad-to-none, run length, season range, break every N stacked programs). Scenario table is now executable: `packages/core/test/scenarios.test.ts`, one test per row, open rows as `it.todo`. UI simplicity pass: Format card is six plain-language presets with every knob under "Customize"; Shows card is picker + order with the rest under "More options"; interstitial pools show one summary line with the editor behind "Edit".
- 2026-09-05: pool length range (min/max), saved searches replacing tag chips, break fallback (interval / offsets) with a chapters-honored switch, removed the hidden 24-ads-per-break cap, pool contents cached per simulation run (450 ms to 30 ms on a 3.6k-item library), help tooltips on channel sections.
