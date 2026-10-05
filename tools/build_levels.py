#!/usr/bin/env python3
"""Convert The Bub's Brothers MacBinary level sets (*.bin) into web assets.

Reads the LEVL (level data) and ppat (wall art) resources of each set and writes:

  <out>/<id>.json             level data for the whole set (100 levels)
  <out>/<id>/NNN.png          512x400 RGBA wall layer (walls + drop shadows, transparent bg)
  <out>/<id>/NNN_tile.png     raw ppat wall pattern (tiled modulo its 16x16 cell count)
  <out>/<id>/NNN_border.png   raw side-border pattern, when the level has one
  <preview>/preview_<id>.png  10x10 contact sheet with --preview DIR (half scale, walls on black)

Formats follow bubbob/macbinary.py and bubbob/binboards.py of bubbros 1.6.2.

Usage: python3 tools/build_levels.py [--src assets-src/bubbros-1.6.2] [--out public/assets/levels]
"""

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent

SETS = [
    ("original", "Levels.bin", "Bub & Bob"),
    ("lost", "LostLevels.bin", "Lost Levels"),
    ("fun", "HouseOfFun.bin", "House of Fun"),
    ("arena", "Arena.bin", "Arena"),
]

CELL = 16
WIDTH, HEIGHT = 32, 25
NMONSTERS = 30
MONSTER_TYPES = ["nasty", "monky", "ghosty", "flappy", "springy", "orcy", "gramy", "blitzy"]
WINDS = {0: " ", 1: ">", 2: "<", 3: "v", 4: "^", 5: "x", 0x66: " "}
FLAGS = ["flag0", "letter", "fire", "lightning", "water", "top", "flag6", "flag7"]
SHADOW_DEPTH = 8
# Shadow look: flat band of the tile's mean colour darkened to this factor (arcade style).
SHADOW_FACTOR = 0.45


# ---------------------------------------------------------------- MacBinary

def padto(n, m):
    return (n + m - 1) & ~(m - 1)


def read_resources(path):
    """Return {type(str): {id: bytes}} from a MacBinary file's resource fork."""
    raw = path.read_bytes()
    datalen, reslen = struct.unpack_from(">ll", raw, 0x53)
    fork = raw[padto(0x80 + datalen, 0x80):][:reslen]
    ofsdata, ofsmap, lendata, lenmap = struct.unpack_from(">llll", fork, 0)
    fdata = fork[ofsdata:ofsdata + lendata]
    fmap = fork[ofsmap:ofsmap + lenmap]
    ofstype, _ofsname = struct.unpack_from(">HH", fmap, 24)
    numtypes = struct.unpack_from(">H", fmap, ofstype)[0] + 1
    out = {}
    for i in range(numtypes):
        rtype, num, ofsref = struct.unpack_from(">4sHH", fmap, ofstype + 2 + 8 * i)
        res = {}
        for j in range(num + 1):
            rid, _name, _attr, hi, lo = struct.unpack_from(">HHBBHxxxx", fmap, ofstype + ofsref + 12 * j)
            ofs = (hi << 16) | lo
            length = struct.unpack_from(">l", fdata, ofs)[0]
            res[rid] = fdata[ofs + 4:ofs + 4 + length]
        out[rtype.decode("mac_roman")] = res
    return out


def decode_ppat(data):
    """Decode an indexed ppat resource into an (h, w, 3) uint8 array."""
    pattype, patmap, patdata = struct.unpack_from(">Hll", data, 0)
    if pattype != 1:
        raise ValueError("pattern type %d not supported" % pattype)
    (rowbytes, h, w, packtype, _packsize, pixeltype, pixelsize, cmpcount, cmpsize,
     pmtable) = struct.unpack_from(">xxxxHxxxxHHxxHlxxxxxxxxHHHHxxxxlxxxx", data, patmap)
    rowbytes &= 0x3FFF
    if packtype != 0 or pixeltype != 0 or cmpcount != 1:
        raise ValueError("unsupported ppat (pack %d, pixelType %d)" % (packtype, pixeltype))
    assert cmpsize == pixelsize and pixelsize in (1, 2, 4, 8)
    size = struct.unpack_from(">xxxxxxH", data, pmtable)[0] + 1
    lut = np.zeros((256, 3), np.uint8)
    for k in range(size):
        idx, r, g, b = struct.unpack_from(">HHHH", data, pmtable + 8 + 8 * k)
        lut[idx & 0xFF] = (r >> 8, g >> 8, b >> 8)  # same as int(v/256.0)
    rows = np.frombuffer(data, np.uint8, rowbytes * h, patdata).reshape(h, rowbytes)
    # MSB-first unpacking of pixelSize-bit indices
    ppb = 8 // pixelsize
    shifts = np.array([(ppb - 1 - i) * pixelsize for i in range(ppb)], np.uint8)
    idx = ((rows[:, :, None] >> shifts) & ((1 << pixelsize) - 1)).reshape(h, rowbytes * ppb)[:, :w]
    return lut[idx]


def decode_levl(data):
    walls = []
    for y in range(HEIGHT):
        row = data[y * 4:y * 4 + 4]
        walls.append("".join("#" if (row[x // 8] >> (x % 8)) & 1 else " " for x in range(WIDTH)))
    winds = []
    for y in range(HEIGHT):
        row = data[100 + y * WIDTH:100 + (y + 1) * WIDTH]
        winds.append("".join(WINDS[v] for v in row))
    monsters = []
    for i in range(NMONSTERS):
        x, y, t, f1, f2, _f3 = data[900 + 6 * i:906 + 6 * i]
        if t:
            assert f1 == 0, f1
            monsters.append({"type": MONSTER_TYPES[t - 1], "x": x, "y": y, "dir": 1 if f2 == 0 else -1})
    flagbytes = data[1082:1090]
    flags = {name: bool(flagbytes[i]) for i, name in enumerate(FLAGS)
             if name in ("letter", "fire", "lightning", "water", "top")}
    testline = walls[0] if flags["top"] else walls[-1]
    return {"walls": walls, "winds": winds, "monsters": monsters, "flags": flags,
            "holes": "  " in testline}


# ---------------------------------------------------------------- rendering

def mean_color(img):
    return img.reshape(-1, 3).astype(np.float64).mean(axis=0)


def render_walls(walls, tile, border):
    """Return (512x400 RGBA wall layer, wall mask) following boards.py/binboards.py."""
    W, H = WIDTH * CELL, HEIGHT * CELL
    th, tw = tile.shape[:2]
    wnx, wny = tw // CELL, th // CELL
    rgb = np.zeros((H, W, 3), np.uint8)
    mask = np.zeros((H, W), bool)
    # per-pixel colour the shadow is cast with (mean colour of the source pattern)
    src_mean = np.zeros((H, W, 3), np.float64)
    tile_mean = mean_color(tile)

    xrange = range(2, WIDTH - 2) if border is not None else range(WIDTH)
    for y in range(HEIGHT):
        for x in xrange:
            if walls[y][x] == "#":
                dx, dy = (x % wnx) * CELL, (y % wny) * CELL
                sl = np.s_[y * CELL:(y + 1) * CELL, x * CELL:(x + 1) * CELL]
                rgb[sl] = tile[dy:dy + CELL, dx:dx + CELL]
                mask[sl] = True
                src_mean[sl] = tile_mean

    border_mask = np.zeros((H, W), bool)
    if border is not None:
        bh, bw = border.shape[:2]
        left = border[:, :32]
        right = border[:, 32:64] if bw == 64 else left
        bmean = mean_color(border)
        step = bh // CELL * CELL
        for y0 in range(0, H, step):
            hh = min(bh, H - y0)
            for x0, strip in ((0, left), (W - 32, right)):
                rgb[y0:y0 + hh, x0:x0 + 32] = strip[:hh]
                border_mask[y0:y0 + hh, x0:x0 + 32] = True
                src_mean[y0:y0 + hh, x0:x0 + 32] = bmean

    # Shadows. Tile walls: union of the wall mask shifted diagonally by k=1..8 px
    # (exactly the sheared 8-px band of binboards.addshadow). Borders: plain horizontal
    # 8-px band to the right (binboards.addrshadow).
    shadow = np.zeros((H, W), bool)
    shade_col = np.zeros((H, W, 3), np.float64)
    for k in range(SHADOW_DEPTH, 0, -1):  # nearest shift written last -> wins
        m = np.zeros((H, W), bool)
        m[k:, k:] = mask[:-k, :-k]
        c = np.zeros((H, W, 3))
        c[k:, k:] = src_mean[:-k, :-k]
        shadow |= m
        shade_col[m] = c[m]
        if border is not None:
            mb = np.zeros((H, W), bool)
            mb[:, k:] = border_mask[:, :-k]
            cb = np.zeros((H, W, 3))
            cb[:, k:] = src_mean[:, :-k]
            shadow |= mb
            shade_col[mb] = cb[mb]
    solid = mask | border_mask
    shadow &= ~solid
    out = np.zeros((H, W, 4), np.uint8)
    out[shadow, :3] = np.clip(shade_col[shadow] * SHADOW_FACTOR, 0, 255).astype(np.uint8)
    out[shadow, 3] = 255
    out[solid, :3] = rgb[solid]
    out[solid, 3] = 255
    return out


def contact_sheet(renders, title):
    cw, ch = WIDTH * CELL // 2, HEIGHT * CELL // 2
    pad = 4
    sheet = Image.new("RGB", (10 * (cw + pad) + pad, 10 * (ch + pad) + pad + 20), (40, 40, 40))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((pad, 4), title, fill=(255, 255, 255), font=font)
    for i, rgba in enumerate(renders):
        im = Image.new("RGB", (WIDTH * CELL, HEIGHT * CELL), (0, 0, 0))
        im.paste(Image.fromarray(rgba, "RGBA"), (0, 0), Image.fromarray(rgba, "RGBA"))
        im = im.resize((cw, ch), Image.LANCZOS)
        x, y = pad + (i % 10) * (cw + pad), 20 + pad + (i // 10) * (ch + pad)
        sheet.paste(im, (x, y))
        draw.rectangle((x + 1, y + 1, x + 22, y + 12), fill=(0, 0, 0))
        draw.text((x + 3, y + 1), "%d" % (i + 1), fill=(255, 255, 0), font=font)
    return sheet


def build_set(set_id, filename, name, src, out, preview=None):
    res = read_resources(src / "bubbob" / "levels" / filename)
    levl, ppat = res["LEVL"], res["ppat"]
    ids = sorted(levl)
    outdir = out / set_id
    outdir.mkdir(parents=True, exist_ok=True)
    levels, renders, odd = [], [], []
    for n, rid in enumerate(ids):
        lv = decode_levl(levl[rid])
        tile = decode_ppat(ppat[128 + n])
        th, tw = tile.shape[:2]
        assert th % 16 == 0 and tw % 16 == 0, (set_id, n, tw, th)
        border = decode_ppat(ppat[228 + n]) if (228 + n) in ppat else None
        if border is not None:
            assert border.shape[1] in (32, 64), (set_id, n, border.shape)
        if (tw, th) != (16, 16):
            odd.append("L%d tile %dx%d" % (n + 1, tw, th))
        num = "%03d" % (n + 1)
        Image.fromarray(tile, "RGB").save(outdir / (num + "_tile.png"), optimize=True)
        if border is not None:
            Image.fromarray(border, "RGB").save(outdir / (num + "_border.png"), optimize=True)
        layer = render_walls(lv["walls"], tile, border)
        Image.fromarray(layer, "RGBA").save(outdir / (num + ".png"), optimize=True)
        renders.append(layer)
        r, g, b = (int(round(v)) for v in mean_color(tile))
        lv["color"] = "#%02x%02x%02x" % (r, g, b)
        lv["tile"] = {"w": tw, "h": th}
        lv["border"] = {"w": border.shape[1], "h": border.shape[0]} if border is not None else None
        levels.append(lv)
    doc = {"id": set_id, "name": name, "width": WIDTH, "height": HEIGHT, "levels": levels}
    (out / (set_id + ".json")).write_text(json.dumps(doc, separators=(",", ":")))
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        contact_sheet(renders, "%s (%s)" % (name, filename)).save(preview / ("preview_%s.png" % set_id), optimize=True)

    counts = [sum(m["type"] == t for l in levels for m in l["monsters"]) for t in MONSTER_TYPES]
    nb = sum(l["border"] is not None for l in levels)
    print("%-8s %3d levels, monsters by type %s, last level monsters=%d, borders=%d, holes=%d"
          % (set_id, len(levels), "/".join(map(str, counts)), len(levels[-1]["monsters"]), nb,
             sum(l["holes"] for l in levels)))
    if odd:
        print("         non-16x16 tiles:", ", ".join(odd))
    return levels


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", default="assets-src/bubbros-1.6.2")
    ap.add_argument("--out", default="public/assets/levels")
    ap.add_argument("--preview", help="directory for 10x10 contact sheets (not shipped with the game)")
    a = ap.parse_args()
    src, out = REPO / a.src, REPO / a.out
    out.mkdir(parents=True, exist_ok=True)
    for set_id, filename, name in SETS:
        build_set(set_id, filename, name, src, out, REPO / a.preview if a.preview else None)


if __name__ == "__main__":
    sys.exit(main())
