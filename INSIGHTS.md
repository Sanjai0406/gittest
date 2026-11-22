# Insights

All numbers come from the 5-day sample (796 matches: Ambrose Valley 566, Lockdown 171, Grand Rift 59) and can be reproduced in the tool: use the heatmap modes, the **Storm death / PvP kill / Bot paths** quick filters, and hover for world coordinates. "Cell" = a 16×16 grid over the minimap. Matches are very short on average (median 6–7.5 min) and almost always contain exactly one human, so read these as *single-player-vs-bots* findings.

---

## 1. The map is played on ~10% of its surface: loot decides where everyone goes

**What caught my eye.** Switch Heatmap → *Loot*, then → *Traffic*: they are nearly the same picture.

**Evidence.**
* The top 10% of cells hold **81% of all loot pickups on Ambrose Valley, 83% on Lockdown, 74% on Grand Rift**. Top 10% of cells hold only 56–63% of *movement*, so players walk everywhere but only *stop* in a few places.
* Per-cell loot vs traffic correlation is **0.88 / 0.85 / 0.80** (Ambrose / Lockdown / Grand Rift): players route to loot.
* Ambrose's three biggest loot cells (586, 533 and 494 pickups) are at world ≈ (−61, −332), (108, −276) and (−286, 61). One east-central block (world x 80…192, z −135…−23) alone takes ~14% of the map's loot.
* Dead space: **23% of Ambrose's walked cells, 29% of Lockdown's, 44% of Grand Rift's have zero loot** even though players cross them. Example, Ambrose south-west corner (≈ −290, −330): 369 position samples, 0 pickups; (−118, 283): 366 samples, 5 pickups.
* Timing is front-loaded too: **29% of loot is picked in the first 2 min, 68% in 5 min, only 4% after 10 min.**

**Actionable?** Yes.
* *Items:* re-seed loot into walked-but-empty cells and a ring of secondary hotspots (higher-tier items on the edges). Move one or two top-tier spawns out of the centre block.
* *Metrics expected to move:* spatial entropy of loot/traffic (route diversity), % of map area visited per match, loot-per-minute after minute 5, time-to-first-loot, and bot-kill share in the centre.
* *Validate:* re-run the Loot and Traffic heatmaps after a change; the cold cells should warm up without the hotspots collapsing into a single new centre.

**Why a Level Designer should care.** Most of the authored space (the south-west and north-east sectors of Ambrose, large parts of Grand Rift) is traffic without purpose. Art and encounter budget is being spent where nobody lingers.

---

## 2. In practice this is a PvE game: bots kill players, players don't kill players, and deaths sit on the loot hotspots

**What caught my eye.** The kill marker legend is nearly all orange (bot) and almost never red (human).

**Evidence.**
* **794 of 796 matches contain exactly one human.** Human-vs-human kills in 5 days: **3** (vs ~2,400 bot kills). The *PvP kill* filter finds the few matches that have one.
* How human journeys end (798): **50% killed by a bot, 4.9% storm, 0.4% by a human, 44% no death event** (extracted or quit). Median death by a bot at 4:00; 90% of bot deaths happen before 8:08.
* Deaths are spatially concentrated: top 10% of cells contain **89% (Ambrose), 86% (Lockdown) of bot-caused deaths**, and cell-level death count correlates with loot (r = 0.52 Ambrose, 0.62 Grand Rift, 0.43 Lockdown). The central block of Ambrose is the most lethal: its two deadliest 8×8-grid cells record 86 and 85 player deaths.
* Combat is also *mostly* in hotspot cells: kills ↔ loot r = 0.66 on Ambrose. E.g. the (108, −276) loot cell has 533 pickups and 88 bot kills; the (−61, −332) cell has 586 pickups but only 4 bot kills: a rich, quiet, low-risk spot.
* Bots are under-instrumented: bot *paths* exist in only 52 matches, but human-recorded bot kills occur in 605.

**Actionable?** Yes.
* *Balance:* the risk/reward map is uneven. Quiet high-loot cells (e.g. the −61, −332 cell) are strictly dominant; add bot patrols or sight lines there, and shorten bot exposure around the deadliest central cells if early deaths are hurting retention.
* *Product/telemetry:* if PvP is meant to be a pillar, the one-human-per-match population means the level design for PvP (flanks, sightlines, extraction contest) is currently untestable. Fix matchmaking/pop first, and log bot positions in every match.
* *Metrics:* early-death rate (<4 min), deaths per hotspot cell, kills per minute, PvP encounters per match, extraction rate by route.

**Why a Level Designer should care.** The only "opponent" shaping the layout is bot spawn/patrol placement. Level design decisions about cover, loot and bot placement currently *are* the difficulty curve.

---

## 3. The storm is almost irrelevant: it only matters in the last quarter of the longest matches

**What caught my eye.** Heatmap → *Storm* is a handful of faint blobs; the timeline ticks for the *Storm death* filter all sit at the far right.

**Evidence.**
* Only **39 storm deaths in 796 matches (4.9% of human journeys)**. By map: Lockdown 9.9%, Grand Rift 8.5%, Ambrose Valley 3.0%.
* Every storm death happens late: **earliest 10:55, median 12:19, latest 14:47**. Only 17.6% of matches last ≥ 10:55 and of those 28% contain a storm death.
* Meanwhile the player's run is front-loaded: median bot-death at 4:00, 68% of loot done by 5:00. Most journeys end (death, extraction or quit) long before the storm arrives: median match length is 6–7.5 min.
* Storm deaths are not at the map edge: their median distance from map centre equals that of normal traffic (0.23 vs 0.24 of map width), i.e. players die to the storm wherever they happen to be loitering, not because of a specific unreachable pocket.

**Actionable?** Yes.
* *Tuning:* start the storm earlier / compress its timeline (e.g. first shrink before ~6 min, so it overlaps the loot→extract window) or add a mid-match pressure beat. On Lockdown and Grand Rift, where players survive longer, storm deaths are already 3× Ambrose's.
* *Design:* use the storm's path to shape routes: places where the storm arrives *before* extraction should be reachable; confirm with the *Build up with timeline* heatmap and the Storm filter.
* *Metrics:* storm-death rate (target: a deliberate, non-trivial share), time-in-storm, extraction success rate, match duration distribution, % of journeys that reach 10 min.

**Why a Level Designer should care.** The storm is the game's only forcing function for movement and extraction pressure; if 95% of players never meet it, the extraction tension the map is designed around isn't being exercised, and late-game areas of the map are effectively dead (only ~4% of loot and a shrinking sliver of traffic occur after 10 min).

---
_Caveats: sample is 5 days and 339 players; correlations are cell-level and don't prove causation (e.g. players that survive longer also loot more, so loot-count vs death rate is confounded and deliberately not used above). 'No death event' journeys could be extractions or disconnects; the data has no extraction event._
