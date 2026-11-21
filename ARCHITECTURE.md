# Architecture

## What I built with, and why
| Layer | Choice | Why |
|---|---|---|
| Pipeline | Python (pyarrow, pandas) | Parquet + bytes decoding is a one-liner; runs once offline |
| Data delivery | Static JSON per map (+ small `index.json`) | Whole dataset is ~89k rows → 1.7 MB raw / ~0.5 MB gzipped. No server or DB needed, so hosting is free and the tool can't go down |
| Frontend | Vanilla JS + Canvas 2D | Tens of thousands of points, pan/zoom and 60 fps playback are trivial on canvas; no framework/build step keeps it reviewable and fast to load |
| Hosting | Static site (Vercel) | Shareable link, CDN-cached |

## Data flow
```
player_data/February_xx/*.nakama-0 (1,243 parquet files → 1,242 distinct journeys; 1 file = 1 player in 1 match)
   │  build_data.py: read → decode `event` bytes → classify human/bot → match-relative time
   │                 → world(x,z) → UV → quantise → group by map → by match (columnar arrays)
   ▼
web/data/index.json        map configs + match list (id, day, duration, humans/bots, kills, deaths)
web/data/<Map>.json        per match: players[], and flat columns p,t,u,v,e
   │  fetch (index first, map file on tab switch, cached)
   ▼
app.js: split into per-player path points + discrete events → "scope" (filtered matches)
        → flat typed lists used by heatmap, hover, stats, timeline ticks → canvas render
```
Filters (date / match / quick chips) only change the *scope*; every view (paths, markers, heatmap, stats, ticks) is derived from the same scope, so they can never disagree.

## Coordinate mapping (the tricky part)
The README gives per map `scale`, `origin_x`, `origin_z`. For an event at world `(x, z)`:
```
u = (x - origin_x) / scale            v = (z - origin_z) / scale
pixel_x = u * W                       pixel_y = (1 - v) * H      # image Y points down, world Z points up
```
* `y` is **elevation** and is ignored for 2D plotting.
* The pipeline stores only `u` and `v` (0–1, quantised to 1/4096 ≈ 0.2 m). The browser multiplies by its own logical 1024 canvas. This makes the mapping independent of image resolution: the supplied minimaps are **not** 1024 px as the README says (Ambrose 4320², Lockdown 9000², GrandRift 2160×2158), so I downsized them to 2048 px WebP and never hard-code pixel sizes.
* Hover shows the inverse transform (`x = u*scale + origin_x`, `z = (1−v)·…`) so designers get real world coordinates.
* **Validation:** 0 of 89,016 points fall outside [0,1]² on any map. Traffic follows the roads/bridges on Ambrose Valley and stays on land on Lockdown (water in the north is empty), which a wrong origin or a missing Y-flip would visibly break.

## Assumptions / data quirks I ran into
| Quirk | What I did |
|---|---|
| `ts` is typed as timestamp[ms] but values are ~1.77e9, i.e. **epoch seconds** read as ms (shows as 1970-01-21). Position samples are exactly 5 apart | Reinterpret the raw int as seconds. Match time = `ts − min(ts of match)`. Matches last 0:13–14:50. Wall-clock start (UTC) is also kept for the match list |
| Filename rule "numeric id = bot" is wrong for 17 files (17 files with id 1429, 1379, 1402 emit human `Position`/Loot, no `BotPosition`) | Classify by emitted position event: `BotPosition` → bot, `Position` → human. Event type, not filename, is the source of truth |
| 794 of 796 matches have exactly one human; PvP kills: 3 in total | Kept as is; it shapes the insights (the game is effectively PvE in this sample). "PvP kill" quick filter exists to find them |
| Bot paths are recorded in only 52 matches, yet `BotKill` happens in 605 matches | Bot paths shown where they exist; bot *kills/deaths* are always shown because they live in the human's file. Likely a telemetry gap |
| `BotKill/BotKilled` also appear in bot files (183/297 rows), semantics undocumented | Plotted like other combat events at their position; tooltip names the owner (Bot/Human) |
| Event semantics of "kill zone" vs "death zone" | Kill = location of Kill/BotKill rows; Death = Killed/BotKilled/KilledByStorm rows (victim location). Combat heatmaps are about human-involved combat only; bot-vs-bot is not recorded |
| One match file (`cfa03e9f…_ac049b28…`) is shipped byte-identical in both `February_10` and `February_11` (match straddles the day cut). README counts 1,243 files, there are 1,242 distinct journeys | De-duplicated by filename (first folder wins) so its 88 rows aren't double-counted. 89,016 unique rows. `Feb 14` is a partial day, flagged as such by the source |
| Folder date vs wall-clock: 14 events in `February_10` fall on Feb 9 UTC and 422 in `February_11` on Feb 10 UTC (folders look like a non-UTC day cut) | Date filter uses the folder (the provided partition); match start times shown in the list are UTC |
| Matches with a single human can have 0:13 duration (10 under 1 min) | Kept; usable via "Sort: longest" to hide them |
| Minimap square vs non-square (GrandRift 2160×2158) | Treated as square per spec (0.1% distortion) |

## Major trade-offs
| Decision | Alternatives considered | Why |
|---|---|---|
| Pre-process to static JSON | Parquet-WASM / DuckDB-WASM in browser, or an API + DB | Static JSON loads in <1 s, no infra, still trivially re-runnable. Cost: re-run the script for new days |
| Per-map JSON (all matches) | One file per match | 566 matches on Ambrose still only ~0.3 MB gzipped; one request enables whole-map heatmaps. Would shard by day at ~100× the data |
| Canvas 2D | WebGL/deck.gl, SVG, Leaflet | Canvas handles ≤90k points + playback without dependencies; SVG too slow, WebGL overkill |
| Heatmap = gaussian splat into a 256² grid, colourised, upscaled | Library (heatmap.js), KDE server-side | Recomputes in a few ms so it can follow the timeline; robust 98.5-percentile normalisation keeps one hot cell from washing out the rest |
| Quantise coordinates to 1/4096 | Full float32 | 0.2 m error is below the position sampling noise; halves payload |
| Selection = multi-select, none = everything | Single-match only | Designers need both a single replay and aggregate behaviour; overlays align at match time 0 |
| Vanilla JS | React/Vite | Less machinery for one screen; trade-off is a single ~500-line app.js rather than components |
