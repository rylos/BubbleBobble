#!/usr/bin/env python3
"""Render the NES pixel font into an 8x8 bitmap atlas (ASCII 32..127, 16 per row)."""
import argparse
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
GLYPH = 8
COLS = 16

# glyphs missing from the NES font (it draws a box for them)
EXTRA = {
    "/": ["......##", ".....##.", "....##..", "...##...", "..##....", ".##.....", "##......", "........"],
    "(": ["...##...", "..##....", ".##.....", ".##.....", ".##.....", "..##....", "...##...", "........"],
    ")": ["..##....", "...##...", "....##..", "....##..", "....##..", "...##...", "..##....", "........"],
    "+": ["........", "...##...", "...##...", ".######.", "...##...", "...##...", "........", "........"],
    "*": ["........", ".##..##.", "..####..", "########", "..####..", ".##..##.", "........", "........"],
    "%": [".##...##", ".##..##.", "....##..", "...##...", "..##....", ".##..##.", "##...##.", "........"],
    "=": ["........", "........", ".######.", "........", ".######.", "........", "........", "........"],
    "<": ["....##..", "...##...", "..##....", ".##.....", "..##....", "...##...", "....##..", "........"],
    ">": ["..##....", "...##...", "....##..", ".....##.", "....##..", "...##...", "..##....", "........"],
    "#": [".##..##.", "########", ".##..##.", ".##..##.", ".##..##.", "########", ".##..##.", "........"],
    ";": ["........", "...##...", "...##...", "........", "...##...", "...##...", "..##....", "........"],
    "_": ["........", "........", "........", "........", "........", "........", "........", "########"],
    "[": [".#####..", ".##.....", ".##.....", ".##.....", ".##.....", ".##.....", ".#####..", "........"],
    "]": ["..#####.", ".....##.", ".....##.", ".....##.", ".....##.", ".....##.", "..#####.", "........"],
    "&": ["..###...", ".##.##..", "..###...", ".###.##.", "##.###..", "##..##..", ".###.##.", "........"],
    "$": ["...##...", ".######.", "##.##...", ".#####..", "...##.##", ".######.", "...##...", "........"],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="assets-src/julgen/NES_Font.ttf")
    ap.add_argument("--out", default="public/assets/sprites/font.png")
    args = ap.parse_args()
    font = ImageFont.truetype(str(ROOT / args.src), GLYPH)
    chars = [chr(c) for c in range(32, 128)]
    rows = (len(chars) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * GLYPH, rows * GLYPH), (0, 0, 0, 0))
    for i, ch in enumerate(chars):
        glyph = Image.new("L", (GLYPH, GLYPH), 0)
        ImageDraw.Draw(glyph).text((0, 0), ch, font=font, fill=255)
        glyph = glyph.point(lambda v: 255 if v >= 128 else 0)  # crisp 1-bit pixels
        if ch in EXTRA:
            glyph = Image.new("L", (GLYPH, GLYPH), 0)
            for y, row in enumerate(EXTRA[ch]):
                for x, c in enumerate(row):
                    if c == "#":
                        glyph.putpixel((x, y), 255)
        white = Image.new("RGBA", (GLYPH, GLYPH), (255, 255, 255, 255))
        atlas.paste(white, ((i % COLS) * GLYPH, (i // COLS) * GLYPH), glyph)
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(out, optimize=True)
    print(f"font atlas {atlas.size} -> {out}")


if __name__ == "__main__":
    main()
