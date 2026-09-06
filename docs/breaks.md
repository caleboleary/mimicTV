# Break points

Where the ads go inside an episode. ErsatzTV Next never sees chapters: our playout JSON slices a file with
`in_point_ms`/`out_point_ms`, so break points only exist in mimicTV. Nothing here ever writes to a media file;
the media mount can stay read-only.

## Storage

One JSON per show folder under `data/breaks/`, named by the folder's slug. `library.json` stays a plain record
of what the scan saw; the service composes breaks into library items on read, so a rescan never loses a decision.

```json
{
  "folder": "/media/TV/Hey Arnold (1996)",
  "settings": { "minBlack": 0.3, "pix": 0.10, "edge": 45, "breaksPerEpisode": null },
  "files": {
    "Season 1/Hey Arnold - S01E01.mp4": {
      "key": { "size": 411548382, "durationMs": 1372000 },
      "decision": "detected",
      "breaks": [{ "at": 711200, "source": "detected", "confidence": "strong" }],
      "rejected": [47000, 1369000],
      "measured": { "at": "2026-09-06T21:10:00Z", "settings": { "minBlack": 0.3, "pix": 0.10 }, "blacks": [
        { "t": 711.2, "dur": 1.4, "db": -41, "pre": -25, "post": -20 }
      ]}
    }
  }
}
```

- `decision`: `detected` (the tool's pick, accepted), `manual` (hand-placed), `timed` (no break points; the
  clock's interval fallback applies), `none` (looked, wants no breaks: shorts), or absent (never analyzed).
- Files are keyed by path relative to the show folder; `key` lets a renamed file re-attach instead of re-measuring.
- `measured` is the expensive part (ffmpeg) and is kept so decisions can be revisited without re-running it.

Precedence when composing the library: a saved decision wins; otherwise the file's embedded chapters stand as the
scan found them, whether ours (titled `Segment N`, from the old in-place tool) or the release's. A running channel
therefore never changes until someone decides. The Breaks page says plainly when a show is running on release
chapters (DVD/AMZN scene marks: "about 9 per episode, usually not breaks") and offers "keep the old tool's chapters"
where ours are present.

## Measurement (service, background job)

Per file: `blackdetect` at 160px wide, blacks closer than 1.5 s merged, blacks within `edge` seconds of either end
dropped, then `volumedetect` during the black, 2 s before, and after. Same numbers as `chapterize.py`. One job per
show, queued like a scan, with progress and cancel; results go straight into the breaks file. Budget ~20–40 s per
22-minute episode on CPU, so the UI warns before starting and the job survives page reloads.

Files are skipped when: under 15 minutes (short: `decision: none`), an outlier for their season folder and
runtime class, or already measured with the same settings.

## Decision (core, pure, tested)

Ported from `chapterize.py` with the fixes from its issues list:

1. Group by season folder and runtime class (`round(duration / 11.5 min)`), reject outliers per group.
2. Cluster quiet blacks across the group (peak finding within `tol`). Clusters covering ≥ half the episodes make a
   template: **segment mode**. No template: **story mode**, score each black (length, quiet during, faded before and
   after, near the middle) and take the best N ≥ 60 s apart.
3. Snap each episode to the template; prefer a black 6–15 s earlier when one exists (the cut usually precedes a
   quiet title card). Flag weak matches and close calls.
4. No black near a template centre: fall back to the strongest scene cut beside a silence in the window.

Output per episode: picks, flags, notes; per group: mode, template, coverage. All deterministic from the measured
rows, so the UI can re-run it instantly when settings change.

## UI (Library → show → Breaks)

Opinionated and simple: the tool is what you get, with a few knobs.

1. **Analyze** button with a time estimate ("about 12 minutes for 24 episodes"). Progress bar, cancel.
2. **Preview**: per season, one line of what the tool found ("breaks at ~7:05 and ~14:30 in 22/24 episodes") and a
   bar per episode: measured blacks as ticks, picks as markers, low-confidence rows first. Click a tick to use it,
   drag a marker, "no breaks" per episode.
3. Knobs, hidden behind "Tune": breaks per episode, black sensitivity (three presets mapping to
   `min-black`/`pix`), edge margin.
4. **Save** locks it in. Until saved, the channel preview keeps using whatever it had.
5. Escape hatches on the same screen: *timed breaks instead* (interval fallback), *no breaks*, or *by hand*.

Power users can drop their own file into `data/breaks/` in the shape above; an upload button on the page accepts
one for a show.
