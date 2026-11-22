#!/usr/bin/env python3
"""LILA BLACK telemetry -> static JSON the web viewer loads.

Usage: python pipeline/build_data.py <player_data_dir> <out_dir>
Reads every .nakama-0 parquet file, normalises it, and writes
  <out>/index.json            map list + match list (small, loaded first)
  <out>/<MapId>.json          all events of one map, columnar per match
  <out>/../maps/<MapId>.webp  downsized minimaps
"""
import json, os, sys, glob
from collections import Counter
import pyarrow.parquet as pq
import pandas as pd
from PIL import Image

# README: world -> minimap config (scale, origin_x, origin_z)
MAPS = {
    "AmbroseValley": dict(scale=900, ox=-370, oz=-473, img="AmbroseValley_Minimap.png"),
    "GrandRift":     dict(scale=581, ox=-290, oz=-290, img="GrandRift_Minimap.png"),
    "Lockdown":      dict(scale=1000, ox=-500, oz=-500, img="Lockdown_Minimap.jpg"),
}
EVENTS = ["Position", "BotPosition", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot"]
EV = {n: i for i, n in enumerate(EVENTS)}
Q = 4096  # u/v quantisation: 1/4096 of map width (~0.2 m)


def load(root):
    frames, seen = [], set()
    for day_dir in sorted(glob.glob(os.path.join(root, "February_*"))):
        day = os.path.basename(day_dir).replace("February_", "Feb ")
        for fn in sorted(os.listdir(day_dir)):
            if fn in seen:   # a match that straddles midnight is shipped byte-identical in two day folders
                print("duplicate file in", day, "skipped:", fn); continue
            seen.add(fn)
            try:
                df = pq.read_table(os.path.join(day_dir, fn)).to_pandas()
            except Exception as e:  # corrupt / non-parquet file: skip but report
                print("skip", fn, e); continue
            df["day"] = day
            frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    # event is stored as bytes
    df["event"] = df["event"].map(lambda b: b.decode("utf-8") if isinstance(b, bytes) else b)
    # NOTE: `ts` is declared timestamp[ms] but the integer is really epoch *seconds*
    # (1.77e9 == Feb 2026). Reinterpret the raw int, don't trust the datetime.
    df["epoch"] = df["ts"].astype("datetime64[ms]").astype("int64")
    return df


def main(root, out):
    os.makedirs(out, exist_ok=True)
    df = load(root)
    # Bot detection: filename says numeric id == bot, but 17 numeric-id files (mostly id 1429)
    # emit human `Position` events. Classify per (match,user) by the position event type.
    kinds = df[df.event.isin(["Position", "BotPosition"])].groupby(["match_id", "user_id"]).event.first()
    df = df.join(kinds.rename("pkind"), on=["match_id", "user_id"])
    df["bot"] = (df.pkind == "BotPosition")
    # match-relative time in seconds
    df["t"] = df.epoch - df.groupby("match_id").epoch.transform("min")

    index = {"events": EVENTS, "maps": {}, "q": Q}
    for map_id, cfg in MAPS.items():
        d = df[df.map_id == map_id].copy()
        d["u"] = (d.x - cfg["ox"]) / cfg["scale"]
        d["v"] = (d.z - cfg["oz"]) / cfg["scale"]   # (1-v) flip happens at draw time
        oob = ((d.u < 0) | (d.u > 1) | (d.v < 0) | (d.v > 1)).sum()
        print(map_id, "rows", len(d), "out-of-bounds", oob)
        d["uq"] = (d.u.clip(0, 1) * Q).round().astype(int)
        d["vq"] = (d.v.clip(0, 1) * Q).round().astype(int)
        d["e"] = d.event.map(EV)
        matches = []
        for mid, g in d.groupby("match_id"):
            g = g.sort_values(["t", "e"], kind="stable")
            players = list(dict.fromkeys(g.user_id))
            pidx = {p: i for i, p in enumerate(players)}
            pinfo = [{"id": p, "bot": bool(g[g.user_id == p].bot.iloc[0])} for p in players]
            matches.append({
                "id": mid.replace(".nakama-0", ""),
                "day": g.day.iloc[0],
                "start": int(g.epoch.min()),
                "dur": int(g.t.max()),
                "players": pinfo,
                # flat columnar rows: player, t, u, v, event
                "p": [pidx[u] for u in g.user_id], "t": g.t.astype(int).tolist(),
                "u": g.uq.tolist(), "v": g.vq.tolist(), "e": g.e.astype(int).tolist(),
            })
        matches.sort(key=lambda m: m["start"])
        with open(os.path.join(out, f"{map_id}.json"), "w") as f:
            json.dump({"map": map_id, "matches": matches}, f, separators=(",", ":"))
        index["maps"][map_id] = {
            "scale": cfg["scale"], "ox": cfg["ox"], "oz": cfg["oz"],
            "img": f"maps/{map_id}.webp",
            "matches": [{"id": m["id"], "day": m["day"], "start": m["start"], "dur": m["dur"],
                         "humans": sum(not p["bot"] for p in m["players"]),
                         "bots": sum(p["bot"] for p in m["players"]),
                         "kills": sum(1 for e in m["e"] if e in (2, 4)),
                         "deaths": sum(1 for e in m["e"] if e in (3, 5, 6))} for m in matches],
        }
        # minimap -> web-sized image
        im = Image.open(os.path.join(root, "minimaps", cfg["img"])).convert("RGB")
        im.thumbnail((2048, 2048), Image.LANCZOS)
        im.save(os.path.join(out, "..", "maps", f"{map_id}.webp"), quality=82)
    index["days"] = sorted(df.day.unique())
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print("matches", sum(len(m["matches"]) for m in index["maps"].values()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
