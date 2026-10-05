#!/usr/bin/env python3
"""Convert The Bub's Brothers PPM sprite sheets into PNGs with alpha.

- RGB (1,1,1) is the transparent key colour.
- Files named *_0.ppm are recoloured for each player with palettes.dat
  (palette 0 colour i -> palette p colour i), producing <name>_<p>.png.
- Minigame (extN) images are written to sprites/extN/.
"""
import argparse
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAYERS = 4  # colour variants generated for player-coloured sheets
PALETTE_SIZE = 960
KEY = (1, 1, 1)
# sheets that exist per player colour (name_0.ppm / image1-0.ppm)
COLOURED = {"dragon", "dragon_bubble", "fish", "digits", "point", "game_over", "image1",
            "10000", "20000", "30000", "40000", "50000", "60000", "70000"}


def load_palettes(path):
    data = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    return data.reshape(-1, PALETTE_SIZE, 3)


def to_rgba(rgb):
    alpha = np.where(np.all(rgb == KEY, axis=-1), 0, 255).astype(np.uint8)
    return np.dstack([rgb, alpha])


def recolour(rgb, src_pal, dst_pal):
    """Replace every pixel whose colour is in src_pal by the matching dst_pal colour."""
    flat = rgb.reshape(-1, 3)
    key = (flat[:, 0].astype(np.uint32) << 16) | (flat[:, 1].astype(np.uint32) << 8) | flat[:, 2]
    src_key = (src_pal[:, 0].astype(np.uint32) << 16) | (src_pal[:, 1].astype(np.uint32) << 8) | src_pal[:, 2]
    # first occurrence wins, like the dict lookup in buildcolors.py
    lut = {}
    for i, k in enumerate(src_key.tolist()):
        lut.setdefault(k, i)
    out = flat.copy()
    uniq, inverse = np.unique(key, return_inverse=True)
    for u_idx, u in enumerate(uniq.tolist()):
        if u in lut and u != 0x010101:
            out[inverse == u_idx] = dst_pal[lut[u]]
    return out.reshape(rgb.shape)


def save(rgb, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(to_rgba(rgb), "RGBA").save(path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="assets-src/bubbros-1.6.2")
    ap.add_argument("--out", default="public/assets/sprites")
    args = ap.parse_args()
    src = ROOT / args.src / "bubbob"
    out = ROOT / args.out
    palettes = load_palettes(src / "images" / "palettes.dat")

    jobs = [(p, out) for p in sorted((src / "images").glob("*.ppm"))]
    for ext in sorted(src.glob("ext[0-9]")):
        jobs += [(p, out / ext.name) for p in sorted(ext.glob("*.ppm"))]

    count = 0
    for path, dest in jobs:
        stem = path.stem
        rgb = np.asarray(Image.open(path).convert("RGB"))
        coloured = stem[:-2] in COLOURED and stem[-2] in "_-"
        if coloured and stem[-1] != "0":
            continue  # regenerated from the _0 / -0 sheet below
        if coloured:
            base = stem[:-2]
            sep = stem[-2]
            original1 = path.parent / f"{base}{sep}1.ppm"
            for p in range(PLAYERS):
                if p == 0:
                    img = rgb
                elif p == 1 and original1.exists():
                    img = np.asarray(Image.open(original1).convert("RGB"))  # hand-tuned blue
                else:
                    img = recolour(rgb, palettes[0], palettes[p])
                save(img, dest / f"{base}_{p}.png")
                count += 1
        else:
            save(rgb, dest / f"{stem}.png")
            count += 1
    print(f"{count} sprite sheets written to {out}")
    write_index(src, out)


def sprite_key(k):
    return ":".join(str(x) for x in k) if isinstance(k, tuple) else str(k)


def png_name(ppm):
    return ppm.replace("_%d.ppm", "_{p}.png").replace(".ppm", ".png")


def write_index(src, out):
    """sprites.json: sprite id/key -> [file, x, y, w, h]; '{p}' = player colour."""
    import ast
    import json
    import re
    ns = {}
    exec((src / "sprmap.py").read_text(), ns)
    entries = {sprite_key(k): [png_name(f), *r] for k, (f, r) in ns["sprmap"].items()}
    text = (src / "images.py").read_text()
    for name in ("extramap", "hatmap"):
        m = re.search(name + r" = (\{.*?\n    \})", text, re.S)
        for k, (f, r) in ast.literal_eval(m.group(1)).items():
            entries[sprite_key(k)] = [png_name(f), *r]
    (out / "sprites.json").write_text(json.dumps(entries, separators=(",", ":")))
    print(f"{len(entries)} sprite entries in sprites.json")



if __name__ == "__main__":
    main()
