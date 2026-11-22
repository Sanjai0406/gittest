# LILA BLACK · Player Journey Explorer

A browser tool for Level Designers to see how players actually move, fight, loot and die on the three LILA BLACK maps. Built from 5 days of production telemetry (Feb 10–14, 2026: 796 matches, ~89k events).

**Live tool:** _see the URL in the submission email / top of this repo's description_ (static site, no login, no setup)
**Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [INSIGHTS.md](INSIGHTS.md) · [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)

## What it does

| Requirement | Where |
|---|---|
| Player paths on the correct minimap | Canvas viewer; world→minimap mapping explained in ARCHITECTURE.md |
| Humans vs bots | Humans: solid, bright, thick lines with a white-ringed head. Bots: thin dashed amber lines |
| Distinct markers: kills, deaths, loot, storm | Diamond = got a kill, ✕ = died, red = vs human, orange = vs bot, violet = storm, green dot = loot. Legend entries toggle each type |
| Filter by map / date / match | Map tabs, date chips, sortable match list (multi-select), quick filters: storm death, PvP kill, bot paths |
| Timeline / playback | Play/pause (Space), scrub, 1–50× speed, loop, event ticks on the scrubber; multiple matches overlay aligned to match-time 0:00 |
| Heatmaps | Traffic, kills, deaths, loot, storm; radius/opacity controls; "build up with timeline" shows hotspots forming |
| Hosted + shareable | Static site; "Copy link" stores map, days, selected matches and heatmap in the URL hash |

Extras for designers: hover any marker for type / player / match time / **world coordinates**; the cursor's world (x, z) is shown live; per-player show/hide inside a match; stats panel for whatever is in view.

## Tech stack

* **Pipeline:** Python 3 + pyarrow + pandas + Pillow (`pipeline/build_data.py`)
* **Frontend:** plain HTML / CSS / vanilla JavaScript with `<canvas>`. No framework, no build step, no runtime dependencies
* **Hosting:** any static host (Vercel config included)

## Run locally

```bash
python -m http.server 8000 -d web      # then open http://localhost:8000
```
The processed data (`web/data/*.json`) and web-sized minimaps (`web/maps/*.webp`) are committed, so nothing else is needed to *use* the tool.

### Rebuild the data from the raw parquet (optional)
```bash
pip install -r requirements.txt
python pipeline/build_data.py /path/to/player_data web/data
```
`/path/to/player_data` is the unzipped folder that contains `February_10 … February_14/` and `minimaps/`. The script prints out-of-bounds counts per map (0 for this dataset).

## Environment variables
None.

## Deploy
```bash
npx vercel --prod        # vercel.json serves ./web as a static site
```
(Netlify / GitHub Pages: publish the `web/` directory.)

## Repo layout
```
pipeline/build_data.py   parquet -> compact JSON + resized minimaps
web/                     the deployable site (index.html, app.js, style.css, data/, maps/)
docs/                    walkthrough + screenshots
ARCHITECTURE.md  INSIGHTS.md
```
