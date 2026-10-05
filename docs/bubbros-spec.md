> Written while planning the remake (2026-10-05). Paths under `/tmp/...scratchpad` referred to temporary build experiments and no longer exist.

# The Bub's Brothers 1.6.2 — Technical Re-implementation Spec

Source root: `bubbros-1.6.2/bubbob/` (Python 2, server-side game logic; rendering/sound are done by
thin network clients via `common/gamesrv.py`). All file:line references are relative to `bubbob/`
unless prefixed with `common/`.

Important global findings (things that differ from the arcade Bubble Bobble):
* **No boss fight.** The "final level" of every set is a *timed bonus board* with no monsters
  (3:00 countdown, bubbles raining bonuses); when time runs out the game ends.
* **Hurry-up "Baron von Blubba"** = a random angry monster turned into a *ghost* (`ghost.ppm`, a
  skull-like sprite) that dashes at players; there is no invincible separate Baron entity.
* **Lives are infinite by default** (`limitlives=None`); `-l N` limits them.
* Up to **10 simultaneous players** (`images.MAX = 10`, images.py:9), drop-in/drop-out at any time,
  each with its own colour palette; optional 2 teams.
* Many silly power-ups (≈52 classes), each with a "big" version, plus 7 mini-game "extensions".

---------------------------------------------------------------------------------------------------

## 1. Game loop, coordinates, board geometry

### 1.1 Timing
* `FRAME_TIME = 0.025` s (boards.py:8) → **40 frames/second** nominal.
* The server loop (`bb.py:88-116`, `FnFrame`) repeatedly calls `.next()` on every generator in
  `boards.BoardGen` until the accumulated "frame time" ≥ 1.1, then returns
  `frametime * FRAME_TIME` as the delay before next frame. A normal frame yields
  `BubPlayer.BaseFrametime` (1.0) → one 25 ms tick. `set_frametime(ft)` (boards.py:627) changes game
  speed (0.25 / 0.5 / 2.0 for the Chestnut bonus) and also resamples sound effects at freq × 1/ft.
* Every game object is an `ActiveSprite` (images.py:15) owning a list of Python generators `gen`;
  `images.action()` (images.py:177) advances each generator once per frame. An "angry" sprite also
  has `self.angry=[genangry()]` which advances all its generators *a second time* per frame ⇒
  angry = exactly double speed (images.py:144-163).
* `normal_frame()` (boards.py:677): increments `BubPlayer.FrameCounter`, runs `action()` on all
  active sprites, decrements key-hold timers (`zarkon`), redraws hats, every 32 frames compacts
  sprites and possibly resets game speed (`MultiplyerReset`).

### 1.2 Coordinates & cells
* `CELL = 16` px, `HALFCELL = 8` (boards.py:6-7). Origin top-left, y grows downward.
* Sprite positions are the **top-left** of the image. Dragons, monsters, bubbles are 32×32
  (2×2 cells).
* Board size = number of characters of the wall map. After `register()` (boards.py:1414-1441):
  `bwidth = width*CELL`, `bheight = height*CELL`, `bheightmod = (height+2)*CELL`.
  * Mac `.bin` levels: **32 × 25 cells → 512 × 400 px** (macbinary.py:221-222).
  * `CompactLevels.py`: 29 × 24 cells → 464 × 384 px. `scratch.py`: 36 wide. RandomLevels: 28 × 23.
  * All boards of one set must share the same size.
* Client window = `bwidth + 9*CELL` (144 px side score panel on the right) × `bheight`
  (bb.py:69-70).
* Columns 0-1 and width-2..width-1 are the side walls (usually `##`); player/monster x is
  generally clamped to `32 .. bwidth-64` (`x2bounds`, boards.py:393; falling dragons are nudged
  2 px/frame back inside, player.py:381-385).

### 1.3 Map queries
* `bget(cx, cy)` (boards.py:321): wall char; x outside board → `'#'`; y outside → row 0.
* `wget(px, py)` (boards.py:329): wind char at cell `((px+D)//16, (py+D)//16)` where
  `D = WIND_DELTA` = HALFCELL (8) for `.bin` boards, CELL (16) for `.py` boarddef levels
  (boarddef.py:41). x<0 → `'>'`, x≥width → `'<'`; y<0 → row 0, y≥height → last row.
* `onground(x, y)` (boards.py:344): true iff `y % 16 == 0`, the three cells
  `(x+5)//16, (x+16)//16, (x+27)//16` in row `y//16+1` are empty and at least one of them in row
  `y//16+2` (the row under the feet) is a wall. When the "under-feet" row is `height` (just below
  the board) row **0** is used (wrap-around floor). `underground()` is the mirror test for
  upside-down dragons.

### 1.4 Vertical wrap-around
* `vertical_warp` (boards.py:401-412): if `y >= bheight` → `y -= bheightmod`; if `y < -32` →
  `y += bheightmod`. So the vertical loop length is `height+2` cells: something falling out of a
  hole in the bottom row reappears at y = −32 (just above the top) and falls in. Bubbles with
  `warp=1` (bubbles containing monsters, bubbles shot by players after release) also wrap; plain
  free bubbles that leave the screen are destroyed.
* `Board.holes` = the bottom row (top row if `top` flag) contains two consecutive spaces
  (boards.py:42-46) → enables PlainBubbles to enter through the holes.

### 1.5 Board layout / rendering
* Walls: each `'#'` cell is a 16×16 tile sprite (`patget((num, x%wnx, y%wny))`), i.e. the
  level's pattern image is tiled modulo its tile count `wnx × wny` (boards.py:85-92,138-145).
* If the level has a border pattern `(num,'l')`, columns 0-1 and width-2..width-1 are *not* drawn
  from the tile map but with a 32-px-wide border strip at x=0 (left) and x=(width-2)*CELL (right,
  pattern `(num,'r')` or the left one), repeated every `icon.h//CELL` rows (boards.py:93-155).
* Background (`BOARD_BKGND = 1`, boards.py:11): the wall pattern is scaled ×2 and darkened
  (each RGB byte `>>3`, `common/pixmap.py:65 makebkgnd`), tiled from x=2*CELL+HALFCELL, y=−HALFCELL
  across the playfield, behind everything.
* Board numbers displayed top-left with white digits at (2,2) (player.py:1188-1192).

---------------------------------------------------------------------------------------------------

## 2. Level formats

### 2.1 Level sets shipped
| File | Name in MacBinary | LEVL count | ppat count | Notes |
|---|---|---|---|---|
| `levels/Levels.bin` | "Bub & Bob Levels" | 100 (ids 128-227) | 154 | default set |
| `levels/LostLevels.bin` | "Lost levels" | 100 | 154 | |
| `levels/HouseOfFun.bin` | "House of Fun" | 100 | 172 | |
| `levels/Arena.bin` | "Bub & Bob Arena" | 100 | 128 | |
| `levels/CompactLevels.py` | — | 48 (`level01..level47` + `levelFinal`) | uses `patmap.py` | 29×24 |
| `levels/scratch.py` | — | 40 classes | | 36 wide |
| `levels/RandomLevels.py` | — | generated (`GenerateLevels`) | | 28×23, uses `rnglevel` |

In every `.bin` set, level index 99 (resource 227) has **zero monsters** → it is the final bonus
board. Default `finalboard=100` (bb.py:36).
Monster totals (type 1..8) — Levels.bin: 114/72/76/78/48/60/62/61.

### 2.2 MacBinary container (macbinary.py)
* MacBinary header 128 bytes; `0x53`: data-fork length (int32 BE), `0x57`: resource-fork length
  (macbinary.py:64-65). All shipped files have data-fork length 0.
* Resource fork starts at `padto(0x80 + dataLen, 0x80)` (multiple of 128). Header (16 bytes, BE):
  `ofsData, ofsMap, lenData, lenMap` (int32 each) (macbinary.py:74).
* Map (at `ofsMap`): at map offset 24: `ofsTypeList u16`, `ofsNameList u16` (both relative to map
  start). Type list: `u16 numTypes-1`, then entries of 8 bytes: `type[4], u16 count-1,
  u16 ofsRefList` (ref list offset relative to the type list start).
* Ref entry (12 bytes): `u16 id, u16 nameOfs (0xFFFF = none), u8 attr, u24 dataOfs, u32 reserved`
  (`>HHBBHxxxx`, data offset = hi<<16 | lo). Resource data at `ofsData + dataOfs`:
  `u32 length` then `length` bytes.
* Types used: `LEVL` (levels), `ppat` (pixel patterns = wall art). `clut` exists in the parser
  but is not used.

### 2.3 LEVL resource (1090 bytes) — macbinary.py:219-258
Board index = position in the id-sorted list (id 128 → board 0 … id 227 → board 99).

| Offset | Size | Content |
|---|---|---|
| 0 | 25 × 4 | **Walls**: 25 rows × 32 bits. Cell (x,y) = `(byte[y*4 + x//8] >> (x%8)) & 1` (LSB first). 1 = `'#'`, 0 = `' '`. |
| 100 | 25 × 32 | **Winds** one byte per cell, row-major: `0 ' '` none, `1 '>'` right, `2 '<'` left, `3 'v'` down, `4 '^'` up, `5 'x'` stop, `0x66 ' '` (always present at cell (0,0) — a marker; treat as none). |
| 900 | 30 × 6 | **Monsters**: `x, y, type, f1, f2, f3` (u8 each). `type 0` = empty slot; 1 Nasty, 2 Monky, 3 Ghosty, 4 Flappy, 5 Springy, 6 Orcy, 7 Gramy, 8 Blitzy (binboards.py:55-56). `x,y` = **cell** of the monster's top-left (pixels = ×16; observed x 2..28, y 1..22). `f1` always 0 (asserted). `f2` = direction: **0 → right (+1), 1 → left (−1)** (mnstrmap.py:6). `f3` = "player" (unused by the game). |
| 1080 | 2 | `level` u16 BE (= 0-based index, informational). |
| 1082 | 8 | Flags, one byte each, non-zero = true: `[flag0, letter, fire, lightning, water, top, flag6, flag7]`. `letter`: EXTEND letter bubbles may appear; `fire`/`lightning`/`water`: those special bubbles may appear; `top`: bubbles enter from the **top** holes (and `holes` is tested on the top row) instead of the bottom. flag0/6/7 unused. (The `letter` byte sometimes contains values >1; only truthiness matters.) |

Wind semantics (bubbles.py:12-18): `'<'(-1,0) '>'(+1,0) '^'(0,-1) 'v'(0,+1) 'x'(0,0)`.

### 2.4 ppat resources (wall art) — macbinary.py:183-216, binboards.py:66-121
* `ppat id 128 + boardIndex`: **wall tile pattern**. Width and height are multiples of 16; it is
  cut into 16×16 tiles, tile `(dx,dy)` = pixels `[dx*16 .. +16, dy*16 .. +16]`; wall cell (x,y) uses
  tile `(x % wnx, y % wny)` where `wnx = w/16`, `wny = h/16`.
* `ppat id 228 + boardIndex` (optional): **side border**, 32 or 64 px wide. Left border = columns
  0-31; right border = columns 32-63 if width 64, else same as left. Missing → borders are drawn
  with ordinary tiles.
* ppat layout: `u16 patType (must be 1), u32 patMapOfs, u32 patDataOfs`. PixMap at patMapOfs
  (50 bytes, struct `>xxxxHxxxxHHxxHlxxxxxxxxHHHHxxxxlxxxx`): rowBytes (mask `&0x3FFF`), bounds
  bottom = h, right = w, packType (must be 0), packSize, pixelType (0 = indexed), pixelSize
  (1/2/4/8), cmpCount (1), cmpSize, pmTable offset. Colour table at pmTable:
  `u32 seed, u16 flags, u16 size-1`, then entries `u16 index, u16 r, u16 g, u16 b` → 8-bit = v/256.
  Pixel data at patDataOfs: h rows × rowBytes, indices packed MSB-first.
* Drop shadows added at load (binboards.py:23-48): tile 16×16 → 24×24 with an 8-px shadow on the
  right and bottom, colour = tile's mean colour × (1 − d/8) for shadow step d, rest transparent
  (key colour). Border 32 → 40 wide with a right shadow only. Shadows overlap the next cell.

### 2.5 Python level files (CompactLevels.py / boarddef.py)
```python
class level01(boarddef.Level):
    a = LNasty            # letter -> monster builder (L*/R* = facing left/right)
    b = RNasty            # may also be a tuple of builders
    letter = fire = water = lightning = top = 1   # optional flags (default 0)
    winds = """..."""     # optional, same size as walls
    walls = """
#############################
##         a     b         ##
...
"""
```
* Any char other than `' '`/`'#'` in `walls` is looked up as a class attribute; a monster is
  created at cell `(x, y-1)` (the letter marks the monster's **bottom-left** cell)
  (boarddef.py:7-8, 45-58); the char is then replaced by a space.
* `L<Name>` → dir −1 (left), `R<Name>` → dir +1 (right) (boarddef.py:3-11; `left.dir=1` is the
  binary-style code mapped through `(1,-1)[dir]`).
* Default winds when not given (boarddef.py:59-68), with W = width, H = height:
  row 0 `'>> ' + ' '*(W-6) + ' <<'`; row 1 `'>'*(W/2-2) + 'x'*(rest) + '<'*(W/2-2)`;
  rows 2..H-1 `'>>^' + ' '*(W-6) + '^<<'`. (Bubbles rise along the sides and gather at row 1 centre.)
* Boards are registered sorted by **class name** (`level01` … `level47`, `levelFinal`).
  The last level must have no monsters (README.txt).
* `.py` wall art: `patmap.py` maps `(boardnum, dx, dy)` → (`tmp/patNN.ppm`, rect 24×24 incl.
  shadow) and `(boardnum,'l'|'r')` → 40×32 border; fallback uses `boardnum % 100`
  (images.py:298-304).

### 2.6 Suggested JSON per level
```json
{"index":0,"width":32,"height":25,
 "walls":["####...", "..."],          // 25 strings of '#'/' '
 "winds":["?>  ...", "..."],          // chars ' ><v^x'
 "monsters":[{"type":"Nasty","x":15,"y":5,"dir":-1}],
 "flags":{"letter":false,"fire":false,"lightning":false,"water":false,"top":false},
 "pattern":"ppat128.png", "border":"ppat228.png|null"}
```

---------------------------------------------------------------------------------------------------

## 3. Sprite system

### 3.1 Image files
* All images are binary PPM `P6` (often with `#xCREATOR` comment lines), 24-bit RGB.
  **Transparent key colour = RGB (1,1,1)** (`KEYCOL = 0x010101`, images.py:8).
* Nearly every sheet is a **vertical strip, 32 px wide, one 32×32 frame per 32 px row**, frame
  rect `(0, 32*k, 32, 32)`. Exceptions noted below.
* Sprites are addressed by **integer ids** in `sprmap.py` (`id → (file, rect)`), plus string /
  tuple keys in `images.extramap`/`hatmap` (images.py:347-453) and per-extension `localmap`s.
* Per-player colour: files named `*_%d.ppm` exist per player 0..9; sprite id for player p is
  `id + 1000*p` (images.py:465-467; `birange`, mnstrmap.py:287-292).
* Per-sprite alpha (images.py:473-491): new-bubble frames 0xA0/0xB0/0xC0/0xD0, normal bubble 0xE0,
  dying bubbles 0xD0 (white) / 0xC0 (pink) / 0xB0 (red), star bubbles 0xE0; everything else opaque.
* Transforms available: `'vflip','hflip','cw','ccw','rot180'` (images.py:262-269) – used for
  upside-down dragons, fish, fire on walls.

### 3.2 Player colour palettes (images/buildcolors.py, palettes.dat)
* `palettes.dat` = 28 800 bytes = **10 palettes × 960 colours × RGB** (bytes r,g,b).
  Palette 0 = the colours used in the `_0` images (green Bub). For player p (1..9) each pixel whose
  colour appears in palette 0 at index i is replaced by palette p[i]; other colours unchanged
  (buildcolors.py:123-188). Only `_0` and `_1` files ship; `_2.._9` are generated at startup
  (verified: `_1` = palette 1 mapping of `_0`).
* Dominant body colour per palette: 0 green (0,135,0) · 1 blue (0,102,255) · 2 pink (243,50,147) ·
  3 brown (174,63,32) · 4 orange (255,145,0) · 5 dark red (136,20,20) · 6 grey (94,106,128) ·
  7 teal (13,124,136) · 8 navy (6,64,136) · 9 dark green (0,71,0).
* Coloured files: `dragon_%d` (32×640), `dragon_bubble_%d` (32×512), `fish_%d` (32×224),
  `digits_%d` (14×170), `point_%d` (48×600), `game_over_%d` (64×32), `10000_%d…70000_%d`, and
  `ext1/3/4/6/7 image1-%d.ppm`.

### 3.3 Sprite id map (sprmap.py) — frame k of file = row k
| ids | file (size) | meaning |
|---|---|---|
| 10-19 | `ice_cyan_big, ice_violet_big, peach_big, pastec_big, cream_pie_big, sugar_pie_big, diamond_big_{purple,blue,red,yellow}` (90×90) | Mega-bonuses (wand/chest) |
| 20-26 | `10000_%d … 70000_%d` (~96×45) | big point labels |
| 30 | `lightning_large` 90×66 | Megalightning |
| 31/32 | `yellow_Hurry_up`/`red_Hurry_up` 136×24 | HURRY UP blink |
| 128-130,136-138,144-146,152-154,160-162,168-170 | `extend.ppm` rows 0-17 | Letter bubbles E,X,T,E,N,D (3 frames each) |
| 131-135 | `bubble.ppm` rows 0-4 | bubble exploding |
| 163-165 / 171-173 / 155-157 | `bubble.ppm` rows 5-7 / 8-10 / 11-13 | timeout colours white / pink / red |
| 139 | `door.ppm` | Door bonus |
| 140-143 | `water_surface` 16×16 ×4 | flood waves |
| 176-178,179-181,182-184 | `dragon_bubble_%d` rows 0-8 | fire / lightning / water bubbles |
| 188-190 | rows 9-11 | normal player bubble (3-frame wobble) |
| 191-194 | rows 12-15 | just-shot bubble (growing, 4 frames) |
| 210-222 | `dragon_%d` rows 0-12 | dragon poses (see 3.4) |
| 683-686 | `dragon_%d` rows 13-16 | jump: [0] fall-left, [1] fall-right, [2] rise-left, [3] rise-right |
| 693-695 | `dragon_%d` rows 17-19 | "coming out of bubble" |
| 239.. 425.. | monster sheets | see 3.5 |
| 443-450 | `ghost.ppm` | hurry ghost: left 443-446, right 447-450 |
| 464-467 / 468-471 | `shot.ppm` | player big fire flame left / right |
| 476 | `blitzy_shot` 16×32 | Blitzy shot |
| 477-481, 496 | `bonus_0` | potion notes: coin, flower, trefle, rainbow, green note; 496 pink "100" |
| 482-487 | `spinning_drop` 16×16 | spinning balls |
| 488 | `lightning_small` 24×24 | fired lightning |
| 489 | `fire_drop` 9×16 | fire drop |
| 490-493 | `fire_surface` 16×16 | burning floor flames |
| 495 | `water_still` 16×16 | flood fill |
| 497 | `game_over_%d` 64×32 | "game over" scoreboard icon |
| 499-508 | `digits_%d` 14×17 | player-coloured score digits 0-9 |
| 519-528 / 920-929 / 930-939 | `level_digits` 14×20 | masked / bordered / white digits |
| 529-553 | `point_%d` 48×24 | points labels 100,150,200,250,300,350,500..950,1000,2000..9000 (mnstrmap.py:315-381) |
| 593-682, 691-692 | `bonus_1..bonus_12` (32×256 = 8 frames) | bonus items (mnstrmap.Bonuses list, mnstrmap.py:150-250) |
| 700-706 | `fish_%d` | dragon-as-fish |
| 800-863 | `*_angry.ppm` | angry monster frames |
| 900-909 | `water_flow` 16×16 | water stream tiles (h_flow, v_flow, start_right, bottom, start_left, top, tl/bl/br/tr corners) |
| 910-912 / 913-915 | `big_bubble` 64×64 | big bubble / explosion |
| 940-951 | `star_large` | stars blue,yellow,red,green,magenta,cyan (2 frames each) |
| 952-956 | `big_bubble_2` 64×64 | big bubble appearing |

Extra keys (images.py:347-453): `extra1.ppm`: shield-left/right (32×32), moebius, flower,
flower2, potion4, glasses ±1 (32×16), cactus. `extra2.ppm` 16×16: questionmark1-5, percent,
colon, gameoverbkgnd. `extra3.ppm`: bubbling eyes `('eyes',dx,dy)` + `eyes-blink`. `extra4.ppm`
small stars 16×16 per colour. `extra5.ppm` star bubbles `('starbub',colour,0..2)`. `extra6.ppm`
sheep-sm 32×32, sheep-big 46×50. `extra7.ppm` 8×8 emoticons 0-6. `extra8.ppm` 760×15 = **font**,
ASCII 32..126, 8 px per glyph, drawn with 7 px advance (images.py:493-507). `butterfly.ppm`,
`sheep.ppm` (+ sheep debris a..g), `glue.ppm`, `black.ppm`. `hat1/hat2/hat5.ppm` 32×48 team hats.
`keys.ppm` 128×128 = key-binding icons for the client (bb.py:315-328).

### 3.4 Dragon pose table (player.py:712-739)
`icons[mode, dir]` with dir −1 left / +1 right; `players[k]` = sprite 210+k (+1000·p):
* mode 0,1,2 walk: left k=0,1,2; right k=3,4,5. Walk frame = `mytime//4`, `mytime` cycles 0..11 and
  advances 1 per 2-px step.
* mode 3/4 shooting (fire counter 1-5 / 6-10): left k=6/7, right k=8/9.
* mode 5..8 dying: 5 = k0, 6 = k11/k10, 7 = k12, 8 = k10/k11 (rotation frames).
* mode 9 rising: jumping[2]/[3]; mode 10 falling: jumping[0]/[1].
* mode 11 shielded/invisible-blink: `shield-left/right`; mode 12: `black` (fully invisible, ring).
* Fish mode: FISH_MODE_MAP (player.py:689-705) on `fish_%d` frames.

### 3.5 Monster sheet layout (mnstrmap.py:12-83)
Each `<name>.ppm` is 32 px wide; ids relative to a base B:
`right = B..B+3`, `left = B+4..B+7`, `jailed (in bubble) = B+8..B+10`, `dead (spinning) = B+14..B+17`.
| Monster | B | extra frames | angry sheet ids (right 4, left 4) |
|---|---|---|---|
| Nasty | 239 | — | 800-807 |
| Monky | 265 | weapon 451, weapon decay 452-455 | 808-815 |
| Ghosty | 291 | — | 816-823 |
| Flappy | 317 | — | 824-831 (`flapy_angry.ppm`) |
| Springy | 343 | jump right 369-370, left 371-372; angry jump 840-843 | 832-839 |
| Orcy | 373 | weapon left 456-459, right 460-463 | 844-851 |
| Gramy | 399 | weapon (boomerang) 472-475 | 852-859 |
| Blitzy | 425 | right=left 425-428, jailed 429-431, dead 435-438, shot 476 | 860-863 (both dirs) |
Animation: walk cycles `imgrange()` with 3 frames per image (`cyclic(..., 3)`); jailed cycle
`[j1,j2,j1,j0]` 4 frames each.

---------------------------------------------------------------------------------------------------

## 4. Player (Dragon) physics — player.py

Default capabilities `Dragon.DCAP` (player.py:22-52): `hspeed 1, firerate 2, shootthrust 8.0,
infinite_shield 1, shield 50, gravity 0.21, bubbledelay 0, flower 1, left2right 1, lookforward 1`,
others 0/None.

* **Walking**: `hfp += hspeed` per frame; each whole unit = one 2-px step (player.py:242, 291-316)
  → **2 px/frame = 80 px/s** base. Step blocked when the cell ahead (x0 = `(x+1)//16` going left,
  `(x-3)//16+2` going right; rows `(y+4)//16+1` and `(y+15)//16+1`) is a wall. Odd x is corrected
  first (player.py:226). Same horizontal control in the air.
* **Jump** (player.py:349-364, 332-343): on ground and jump pressed → `up = 7.5`, sound Jump.
  Each frame: `up -= gravity(0.21)`; if `up < 4.0` → up = 0 (apex, start falling) else
  `y -= up` (sub-pixel accumulator). ⇒ **16 rising frames, ≈ 91 px (≈ 5.7 cells)** high.
  Butterfly bonus halves gravity → ~33 frames, ~188 px.
* **Falling** (player.py:370-387): constant **4 px/frame**, y snapped to multiples of 4
  (`(y+4) & ~3`); no acceleration. Landing when `onground`. Falls through the bottom wrap.
* Holding jump continuously re-jumps on landing (key is level-triggered).
* **Bubble riding** (bubbles.py:34-65, player.py:317-353): every frame the dragon calls
  `touched(dragon)` on every sprite overlapping rect `(x+1, y+1, 30, 30)`. For a bubble:
  if `|bx−dx| ≥ 25` or `|by−dy| ≥ 25` the bubble records an obstacle direction (and will not move
  toward the dragon); if the only obstacle is "dragon is above" (bubble.y ≥ dragon.y+25,
  `|dx|<25`) → `onbubble`; if the dragon is pressing jump while `onbubble` it jumps as if on ground
  (bubble flagged `dragon_jumped`). If the overlap is closer (both |dx|,|dy| < 25) the bubble
  **pops** (credited to that dragon). So: touch a bubble → pop; land on top while holding jump →
  bounce off it.
* **Shooting** (player.py:392-405, 595-655): fire allowed when `fire == 0`; `fire` then counts up
  each frame and resets at `64 // firerate` → **32 frames (0.8 s) cooldown** by default (firerate
  3 → 21, 4.5 → 14). Shooting pose for counter 1-10. `DragonBubble(dragon, x+4*dir, y, dir, …)`
  is spawned at `x + 16*dir` (bubbles.py:401).
* **Shot bubble flight** (bubbles.py:413-504): `hspeed = dir * shootthrust (8.0)`; each frame
  `x += hspeed`, `hspeed *= 0.965`, until `|hspeed| < 4.0` → ~20 frames, **≈ 114 px (~7 cells)**.
  Stops (sticks) when cell `(int(x−3.8)//16+1, (y+8)//16)` and the one below are both walls.
  During flight it captures the first monster within margin 9 (random one if several). At the
  end: tries to capture a touchable bonus (margin 15) or BonusMaker (margin 7); then becomes a
  normal floating bubble (timeout 800, see §5) that can also trap other players' dragons.
  Bubble images: grow `new_bubbles[1..3]` then `normal_bubbles[2]` 4 frames each, then the
  normal wobble `[n1,n2,n1,n0]` 5 frames each.
* **Invincibility**: new dragons have `shield = 50` and `infinite_shield = 1`; while
  `infinite_shield` the shield never drops below ~20 and *no collision tests are done at all*;
  it is cancelled at the first key press, after which the shield counts down 1/frame
  (≈ 1.25 s). Shield blink: mode 11 on frames where `shield & 2` (player.py:406-417).
  Shield also set to 50 after teleport/jumping out of a bubble/egg swap; Chickpea adds 420.
* **Death** (player.py:97-147): `die()` ignored while `shield > 0`. Plays Die, 30-frame spin
  animation (modes 5-8 alternating every 2 frames), drops carried bonuses (points subtracted, the
  bonus flies out again) or, if none, with 41 % probability (`random() > 0.59`) loses one random
  EXTEND letter which reappears as a floating letter bubble. Then `lives -= 1` if lives limited.
  Killers: touching an active monster, monster shots, spinning balls, ghost.
* **Respawn** (player.py:857-879, `zarkon` every frame): if a playing player has no dragon and
  `lives != 0`, a new Dragon appears **immediately** at `y = bheight − 3*CELL`,
  `x = 3*CELL` facing right (start_left) or `bwidth − 5*CELL` facing left; tries x offsets
  `+0,+4,+8,+12,+16,−4,−8` px for a free on-ground spot. Power-ups saved in `pcap` are removed
  on respawn except `teleport`/`jumpdown`.
* **Lives**: `gamesrv.game.limitlives` (`-l N`), default `None` = infinite (bb.py:38,
  boards.py:571). **Extra life every `extralife` = 50 000 points** (bb.py:39, player.py:928-942),
  optional `--limitlives` = max lives gained per board. When every playing player has 0 lives the
  game is flagged ended (scoreboard End=1).
* **Power-up persistence between boards**: `savecaps` keeps `max(hspeed,1)`, `max(firerate,2)`,
  `max(shootthrust, 8/1.5)`, `max(flower,-1)` (player.py:53-56, 830-836).
* **Multiple dragons per player** are allowed (Blue Necklace mirror copies, up to 7).
* Fish mode (Conch big): jump = swim up 2 px/frame, otherwise sink 2 px/frame, 5 %/frame emit a
  small bubble.

---------------------------------------------------------------------------------------------------

## 5. Bubbles — bubbles.py

### 5.1 Free-floating bubbles (`Bubble.normal_movements`, bubbles.py:145-192)
* Starts moving **up 1 px/frame** (`dx=0, dy=-1`), afterwards direction = wind under it
  (`wget`): `<`,`>`,`^`,`v` set direction, `x` stops it; blank keeps the last direction.
  1 px per frame in that direction.
* If moving into an obstacle direction (a dragon standing on it) it doesn't move; with direction
  (0,0) and exactly one obstacle it is pushed 1 px away.
* Crowding: every other frame it checks bubbles within margin `13+(timeout&6)`; if another bubble
  is ahead in its direction it pauses for a while (`touchbubble`), producing clustering.
* Leaving the screen: `y < -32` or `y ≥ bheight` → destroyed unless `warp` (then wraps).
* **Lifetime**: player bubble timeout 800 → after **800 frames (20 s)** starts `bubble_red()`
  (bubbles.py:194-204): white `[164,165,164,163]` ×3 (60 f), pink ×4 (80 f), red ×4 (80 f), then
  pink/red blinking 2 f each ×10 (40 f) → **pop with no owner after 260 more frames** (total
  ≈ 26.5 s). PlainBubble timeout 500. Special (fire/water/lightning/letter/star) bonus bubbles have
  `timeout=None` → never expire (they only leave the screen or are popped).
* Cocktail bonus (`bubbledelay`): shot bubbles get timeout 1 (start blinking red at once);
  with 2+ cocktails they pop by themselves after 7 frames.

### 5.2 Popping & chains
* `pop(poplist)` (bubbles.py:119-143): sound Pop, explode animation 131-135 (1 f each). If popped
  by a dragon: dragon gets `popped()` points (**10** for a plain bubble, 50 letter, 100 star /
  big-lightning) and stats. Next frame `poprec()` pops **every bubble overlapping it** with the
  same `poplist` → chain reaction propagates through touching bubbles.
* The shared `poplist` list starts `[dragon]`; each monster killed in the chain appends itself
  (§6.6) → combo multiplier.

### 5.3 Monster capture / escape (monsters.py:288-334)
* `in_bubble`: monster becomes untouchable, angry cleared, follows the bubble, shows jailed frames.
  Captured bubbles have `warp = 1` (wrap vertically).
* Bubble popped by a player → monster `argh()` → becomes a flying fruit (BonusMaker) and the
  popping dragon gets **+90** points (**+990** if it was the last monster of the board), plus
  the bubble's 10.
* Bubble times out (pop with `poplist None`) → monster is released **angry** (double speed) and
  resumes its default behaviour.

### 5.4 Spawning of bonus bubbles (bubbles.py:1236-1284, bonuses.py:2471-2478)
* Each frame of normal play: with p = 0.04 → 15 % try a random bonus item, 85 % `newbubble()`.
* `newbubble` picks uniformly from `Classes = Plain×7 + (Fire, Water, Lightning)×4 + Letter`
  (20 entries) and spawns only if its condition holds: Plain → board has `holes`; Letter →
  `letter` flag; Fire/Water/Lightning → corresponding flag. Max simultaneous: Letter 2,
  Fire/Water/Lightning 4 each, Plain unlimited.
* Entry point (bubbles.py:651-684): `top=0` → x at a random 2-space hole of the bottom row
  (random column 2..width-4 if none), y = bheight, moving up; `top=1` → hole in top row,
  y = −32, moving down; `top=2` → from the left edge at random y; `top=3` → from the right.
* Bubble colour = a random playing player's colour (`sendbubble`).

### 5.5 Special bubbles
* **Fire** (bubbles.py:734-798, `FireBubble.popped`): drops a `FireDrop` (falls 8 px/frame
  until it sits on a wall) which starts `FireFlame` on that cell spreading left/right up to 5 cells
  along platforms; each flame lives 17×2 frames, animated 490-493, kills monsters it touches
  (credited to `[None]`, i.e. no owner → fruit level counted from 0).
* **Water** (bubbles.py:909-1066): spawns a `WaterCell` stream of length 19 at the bubble: the
  head moves 1 cell/frame: down if free, else sideways (reversing up to 3 times), dies when it
  falls off the bottom; carries monsters (killed when the stream ends) and dragons
  (`watermove`), pops bubbles. Tiles 900-909 chosen by neighbour mask.
* **Lightning** (bubbles.py:1084-1111): `FiredLightning` (488) flies horizontally **13 px/frame**
  in the direction *opposite to the popping dragon's facing* (`-dragon.dir`), killing monsters
  and popping bubbles it touches, until off-screen.
* **Letter bubbles** E-X-T-E-N-D (bubbles.py:715-732): letter random 0-5; popping gives 50 pts
  and the letter. Collecting all six → all monsters die (`argh_em_all`), 3 star explosions,
  letters fly, Extralife sound, music Snd5 ("old"), **+100 000 points**, and the board ends
  (`last_monster_killed(460)`) (player.py:950-980). Letters persist across boards until complete
  (then cleared at next board).
* **Star bubble / Monster bubble** – bonus-level only (see §9).
* **Catching dragons**: a bubble that ends its throw without a monster can trap *other players'*
  dragons touching it within 15 px during its first frame(s) (bubbles.py:67-117): the trapped
  player sees "eyes" (`BubblingEyes`) and can steer the bubble 1 px/frame, and escapes by holding
  fire >20 frames or when it is popped/expires. Catcher scores 250 (1 dragon) / 10 000 (2) /
  30 000 (3) / 70 000 (4+), Extra sound.

---------------------------------------------------------------------------------------------------

## 6. Monsters — monsters.py

### 6.1 Common
* `Monster` (monsters.py:13-37): `vx = 2` px/frame, `vy = 0`, `special_prob = 0.2`,
  32×32, touchable. Position from level def `x*CELL, y*CELL`.
* Spawn on board entry (boards.py:211-225): for each definition, number of copies with
  multiplier `f = gamesrv.game.f_monsters` (`-M`), default `clamp((players−2)/2.2 + 1, 1, 2)`:
  `i = random(); while i < f: spawn; dir = -dir; i += 1`. Monsters appear one every 2 frames,
  then **wait 20 frames** (`waiting`, monsters.py:123) before moving.
* Default behaviour for walkers = `falling` → `walking` loop.
* **falling** (monsters.py:199-229): 3 px/frame down, snapping to the cell grid when within 2 px;
  nudged back inside x∈[32, bwidth−64]; wraps vertically.
* **walking** (monsters.py:139-155): while on ground: steps `vx*dir`; reverses at walls
  (`blocked()`: cell beyond front edge in rows `y//16+1` or `(y+31)//16`). When cell-aligned
  (`x&15 < vx`) with prob 0.2 → `special()`. Walking off a ledge: if it "sees" a dragon (same row
  ±16 px, in front) it does a small horizontal hop (`hjumping`: vy −2.2, +0.19/frame, 2 px/frame
  forward), else falls. 20 % per frame: if overlapping another identical monster (±6 px), skip a
  frame (de-stacking).
* **special()** (monsters.py:163-181): choose a random *visible* dragon (not shielded/ring).
  If it sees the dragon and has a shot → shoot. Else if the dragon is higher than one cell, look for
  a platform 2,3,4,5 cells above (`onground(x, y-k*16)`); if found → `vjumping`: turn-around
  animation (1 + 9 + 4 frames) then rise **4 px/frame** straight up to that platform, direction
  50 % keep / 50 % toward dragon.
* **Shooting** (monsters.py:183-197): 10-frame pause, fire, then cooldown 29 frames.
* **Flying** (`Ghosty`, `Flappy`; monsters.py:342-362): moves `vx*dir` horizontally and
  `vy*vdir` vertically every frame, each axis bouncing off walls independently; if completely
  blocked, pushes up/back into the field.
* Contact: dragon touching an active monster dies (`killdragon`). Touching a *frozen* monster
  (Heart Poison) kills the monster instead (monsters.py:276-283).

### 6.2 Types
| Type (code) | vx | vy | Behaviour / attack |
|---|---|---|---|
| Nasty (1) | 2 | – | walker, jumps to platforms; no attack (Zen-Chan) |
| Monky (2) | 2 | – | walker; `MonsterShot` speed **6** px/frame horizontal, sprite 451, decays 452-455 on wall (Mighta-like) |
| Ghosty (3) | 2 | 2 | flies diagonally bouncing (Monsta) |
| Flappy (4) | 2 | 1 | flies, slower vertical (Pulpul) |
| Springy (5) | 2 | – | instead of walking, repeatedly squashes (2+4+2 frames, jump frames 369-372) and jumps a 40-frame parabola: g = 10/43, vy0 = −20·g ≈ −4.65, moving vx horizontally (Banebou) |
| Orcy (6) | 2 | – | walker; `FastShot` speed **15** (fireball 456-463) |
| Gramy (7) | **3** | – | walker; `BoomerangShot` speed 8 that returns to the owner after hitting a wall (472-475) |
| Blitzy (8) | **3** | – | walker; never "sees" dragons; at each special roll 30 % → `DownShot` (476) falling 7 px/frame from its position |
Special classes: `Butterfly` (from Butterfly big bonus; flies randomly, harmless – flies away when
touched, gives ice-cream bonus), `Sheep` (player-controlled, §7), `Lemming`, `Alien` (extensions).

### 6.3 Monster shots (monsters.py:571-647)
Spawned centred on the monster, offset 16 px forward; move `speed*dir` per frame until the cell
ahead (two cells tall) is a wall; kill dragons on touch.

### 6.4 Angry mode
Monster angry = images from `*_angry.ppm` + every generator stepped twice per frame (double
speed, double shooting/jump rate). Triggers: escaping from a timed-out bubble, Hurry Up (one
monster), Carrot bonus (all).

### 6.5 Hurry Up and the ghost ("Baron von Blubba") — boards.py:701-741
In `normal_play`, `framecounter` counts frames while at least one dragon exists; `BASE = 500`:
* at **2000 frames (50 s)**: HURRY UP sign (31/32 blinking, 12×2 images, 2 f each) centred, sound
  **Hurry**; **one** random regular non-angry monster becomes angry.
* at **3000 frames (75 s)** and then every 500 frames: if there is an angry regular monster →
  sound **Hell**, music stopped, a random angry monster `become_ghost()`, counter reset to −200
  (music restarts when the counter returns to 0, i.e. 200 frames later). If no angry monster
  exists, counter = 1000 (hurry repeats 1000 frames later).
* **Ghost behaviour** (monsters.py:511-553): uses `ghost.ppm` (443-450). Every **50 frames** it
  picks a visible dragon and dashes in a straight line along the dominant axis at **10 px/frame
  horizontally or 9 px/frame vertically**, stopping when the distance starts increasing; passes
  through walls; after 5 consecutive 50-frame periods with no visible dragon it turns back into a
  normal monster. Touching kills the dragon, after which the ghost reverts to a normal monster.
  It is excluded from "regular" monsters but *can* still be caught by a bubble.
* Board ends only when the monster list is empty (ghost counts as a monster).

### 6.6 Kill → fruit, score values (monsters.py:325-334, bonuses.py:323-336, mnstrmap.py:151-159)
* `argh(poplist)`: appends itself to poplist; `level = len(poplist) − 2` (0 for the first
  monster of a chain). A `BonusMaker` showing the `dead` frames flies in a parabola
  (dx random ±7.5, dy −8×(0.5..1.5), gravity 0.3, bouncing off side walls) then falls straight
  4 px/frame to the ground and becomes a `MonsterBonus(level)`:
  | level (chain index) | 0 | 1 | 2 | 3 | 4 | 5 | ≥6 |
  |---|---|---|---|---|---|---|---|
  | sprite | 593 banana | 594 peach | 595 quince | 596 pastec | 597 wine | 598 ananas | 599 diamond |
  | points | 1000 | 2000 | 3000 | 4000 | 5000 | 6000 | 8000 |
* Bonus items (fruit) lie 250 frames (6.25 s) then vanish; picked up when overlapping with 10/8 px
  inset; points shown with a rising label (`Points`: up 2 px/frame × 25, hold 20). Fruit taken is
  "carried" for 543 frames: if the dragon dies within that time the fruit (and its points) is lost
  and thrown out again.
* Kills by fire/lightning/flood etc. use `poplist=[None]` → still chain-counted per source, but
  no popping bonus.

---------------------------------------------------------------------------------------------------

## 7. Bonuses — bonuses.py

### 7.1 Generic rules
* `Bonus` (bonuses.py:23-141): default `points = 750`, `timeout = 250` frames, sound `Fruit`,
  falls 4 px/frame to the ground. `RandomBonus.timeout = 500`.
* Spawning (`newbonus`, bonuses.py:2434-2444): only if no RandomBonus is on screen; position from
  `chooseground()` (random 2×2 empty cell pair resting on walls, ≥3 cells from any dragon);
  class uniformly from `Classes` (all RandomBonus subclasses; aliases double weights: WandBonus ×2,
  Fruits ×7, Monsterer ×2 → 60 entries incl. Clock). Chance ≈ 0.04 × 0.15 = 0.6 %/frame when none
  present.
* A bonus can be **bubbled**: shown as a spinning "?" inside the bubble; popping it gives the
  points (minus 10) and its effect to the popper, sound Yippee.
* **TemporaryBonus**: increments `dcap[capname]`, decremented when its `captime` (frames) expires;
  halved (÷2, Ring ÷5) on the bonus board.
* Every RandomBonus has a **big version** (`bigbonus` dict, `bigdoc`) delivered by the Cactus
  (a 3× zoomed icon falling as a Megabonus covered by bubbles).

### 7.2 Complete list (image id from mnstrmap.Bonuses; pts = points on pickup)
| Class | Image | Pts | Effect (normal) | Big version |
|---|---|---|---|---|
| ShoeSpeed | 631 shoe | 750 | hspeed +1 (cumulative) | ×3 |
| CoffeeSpeed | 641 coffee | 750 | hspeed +0.5, firerate +1 | ×3 + break walls when running |
| Butterfly | 678 butterfly | 750 | gravity ×0.5 (higher jump) until death/board | 17 harmless butterflies |
| Cocktail | 668 cocktail | 2000 | bubbledelay+1: short-lived bubbles | ×3 (instant pops) |
| Extend | 647 extend | 0 | gives all missing letters, 10 000 per missing letter → triggers EXTEND | explosion of letter bubbles |
| HeartPoison | 643 heart | 750 | freeze all monsters (touch kills them) | also freezes other players 222 f |
| VioletNecklace | 679 | 650 | duplicate every free monster | rain of 24 new monsters |
| WandBonus | 620-625 wands / 626-629 chests | 750 / 2000 | at board end every bubble becomes a bonus (ices 700-950 / diamonds 6000-9000) + Megabonus (90×90, 20 000-70 000) | — |
| Cactus | 'cactus' | 600 | drops the big version of a random bonus | ×3 |
| Book | 642 book | 2000 | star explosion: 6 stars fly parabolically killing monsters | homing stars |
| Potion | 637/638/639 red/green/yellow, 'potion4' | 150/350/550/750 | clear board, fill top area with notes (coin 350 / rainbow 600; flower 1000 / trefle 2000; green note 2000 / blue note 3000), timed collection then % ranking (Snd3 music). potion4 → runs a mini-game extension | fill whole board |
| FireBubble | 675 hamburger | 750 | next 10 shots are fire bubbles | BigFireBubble flames (464-471) |
| WaterBubble | 671 beer | 750 | next 10 shots are water bubbles | snooker balls |
| LightningBubble | 664 french fries | 750 | next 10 shots lightning | 7-way lightning |
| Door | 139 door | 1000 | star explosion of 10 diamond fruits (8000) | 10 Megadiamonds |
| LongFire | 663 softice1 | 750 | shootthrust ×1.5 | bubbles split into 20 |
| Glue | 'glue' | 850 | triple shot (±0.19 rad), cumulative | heptuple |
| ShortFire | 665 softice2 | 300 | shootthrust ÷1.5 | range 0 |
| HighSpeedFire | 666 custard pie | 700 | firerate +1.5 | ×4 |
| Mushroom | 655 | 900 | pinball: auto-jump, 625 f | 1250 f ×2 |
| AutoFire | 652 rape | 800 | autofire 675 f | 900 frames of extra bubbles |
| Insect | 676 | 750 | walls fall down (gravity on wall blocks) | morph into random level |
| Ring | 640 | 4000 | invisible to monsters (mode 11/12) 700 f | ×3 |
| GreenPepper | 648 | 750 | "hot stuff": run & fire automatically 100 f | 250 f ×2 |
| Lollipop | 667 | 750 | left/right swapped (temporary) | all 4 keys permuted |
| Chickpea | 654 chickpea | 800 | glasses overlay + shield +420 (touch monsters safely) 400 f | lights off (darken screen 597 f) |
| IceCream | 659-662 | 250/500/1000/2000 | spawns 2 of next kind when taken | big ones |
| Grenade | 632 | 550 | fire on every floor cell | flames on walls/ceilings too |
| Conch | 680 | 650 | water flood rising from bottom kills monsters | aquarium: players become fish |
| Umbrella | 633/634/635 | 900/950/1000 | rain of fire drops (10 in 60 f) / water (5 in 60 f) / spinning balls (9 in 120 f, kill dragons too) | ×3.14 |
| Fruits | 600 kirsh 100, 602 erdbeer 150, 604 tomato 200, 606 apple 250, 607 corn 300, 609 radish 350 | as listed | placed in mid-air, not bubblable, sound Extra; 4 % "superfruit" shower of 50-100 fruits | — |
| BlueNecklace | 677 | 1000 | mirror copy dragon (inverted controls) | 3 copies incl. upside-down |
| Monsterer | 645 red / 646 blue crux | 800/850 | become a monster for ~259 frames (player-controlled) | as big ghost |
| Bubblizer | 644 gold crux | 750 | become a special bubble you steer | snooker/big-light bubble |
| Carrot | 651 | 950 | all monsters angry | all monsters become ghosts |
| Egg | 656 | 750 | swap position with another dragon | swap colours too |
| Bomb | 670 | 750 | destroy walls in radius 3.9 cells + stars + screen shake | radius ×√3.8 |
| Ham | 669 | 750 | build random walls (50 %) in radius 3.9 cells, falling | bigger |
| Chestnut | 657 | 750 (no sound) | game speed ×2 or ×0.5 for 430/500 f | 0.25 for 1800 f, or players slower 800 f |
| Clock | 636 | 0 | time machine: replays the board from its start (needs `statesaver` C module) | replay with ghosts of yourself |
| MultiStones | 672 emerald / 681 sapphire / 682 ruby | 1000/2000/3000 | must be touched 10 times | big, repulses dragons |
| Slippy | 649 orange thing | 900 | ice skating inertia 606 f | ×3 |
| Aubergine | 650 | 750 | look backwards (shoot behind) | teleport to bonuses |
| WhiteCarrot | 653 | 650 | fly (slow fall) 650 f | jump down through floors |
| AmphetamineSpeed | 674 tin | 700 | dragon double speed (angry gen) 633 f | ×3 |
| Pear | 658 green thing | 1000 | explosion of 18 sugars (Sugar1 630 250 pts, Sugar2 691 500 pts, carried) | ×4 |
| Fish2 | 673 | 3000 | Megalightning (90×66) sweeps from right to the item, killing | 7 blasts |
| Sheep | 'sheep-sm' | 800 | at board end players lose 2× the points earned this board (sheep animation) | players become sheep (§6.2) |
| Flower | 'flower' | 800 | fire 12 bubbles in a circle (decaying count) | rotating thrower |
| Flower2 | 'flower2' | 1000 | upside-down gravity (temporary) | whole level flipped |
| StarBubble | 'moebius' | 750 | next 3 shots are star bubbles (pop → random bonus) | 10 |
| Donut | 605 | 950 | catch every monster in a bubble | catch dragons too |
Mega-bonuses (`Megabonus`, bonuses.py:613-828): 90×90 image falls from the top (after 71
frames), slows to rest on the floor; shooting it covers it with up to 31 player bubbles (its
point value drops as it's covered, rounded to 10 000); taking it pops them; sound Extra.

### 7.3 Extensions ext1..ext7 (picked by the 4th potion type)
Each runs as a sub-game replacing the board generator: `initsubgame(music)` = clear monsters/
bonuses, loop the extension's `music.wav`, show sub-game score in the panel; at the end a
`result_ranking` (%) screen gives 10 000 × ceil(n/2) … points by rank. Each extension is used at
most once per server run (`Potion.Extensions` popped).
| Ext | Game | Time | Min players | Sprites | Sounds | Rules |
|---|---|---|---|---|---|---|
| ext1 | **Arkanoid** | 60 s | 1 | `image1-%d.ppm` 80×32 paddle per colour | `wall.wav` (bounce), `brick.wav` (brick) | lower half cleared, top rows become bricks; paddle accel 0.75 max 4.5 px/f; ball = player's bubble, speed 5.8; brick hit = 125×2^hits pts; lost ball destroys the paddle (rebuilt after 53 f); score = bricks broken |
| ext2 | **Pac-Man** | 45 s | 1 | `image1.ppm` pac-lg/pac-sm per dir, `image2.ppm` pac-black, pac-dot 8×8 | — | board dug into a maze; dots along walls (+100 each, sound Extra); 2+players/2 monsters become PacGhosts (ghost.ppm) chasing; touch = death (respawn 109 f); fruit 750-1000; score = dots |
| ext3 | **Galaga** | until done | 1 | `image1-%d.ppm` 32×32 ship | `shoot.wav` | walls fall away, winds all 'v'; ship moves 2 px/f, shot 10 px/f, cooldown 28 f; aliens (Flappy/Ghosty) in 3+(players+1)/3 squadrons, fly paths at 5 px/f, form a shifting formation, drop fire (DownShot); hit = +100 pts; formation reaching bottom = game over |
| ext4 | **Tetris** | 90 s | 1 | `image1-%d.ppm` 32×16 = two 16×16 bricks (falling/landed) | (Fruit/Extralife/Extra) | 7 tetrominoes; left/right move, jump rotate, fire drop; full line clears: 500, 1000, 2000, 4000… pts; score = lines |
| ext5 | **Lemmings** | 60 s | 1 | `image1/2.ppm` walk/fall 8+4 frames per dir, `image3.ppm` splat 16 frames, `image4.ppm` jailed | `ouch.wav` | lemmings walk, climb 1-cell steps, die if falling >33 frames; bubble them and let the bubble float off the top: +1 and 500 pts; winds `>>^^^…<<` |
| ext6 | **Tron** | 60 s | **2** | `image1-%d.ppm` 8×80: heads + trail segments 8×8 | `crash.wav` | light-cycles on an 8-px grid, 1 step / 2 frames; no 180° turns; last survivor of each round +1 score, +100 pts |
| ext7 | **Camel** (biplanes) | 90 s | **2** | `image1-%d.ppm` 36×864 = 24 angles ×36 px | `fire.wav`, `hit.wav` (+ ext6 crash) | speed 3.3 px/f, rotate 15°/f, jump = flip, fire 2 shots (7.6 px/f, 22 steps) every 7 f; hit +100 pts; score = planes shot down |

---------------------------------------------------------------------------------------------------

## 8. Sound and music

### 8.1 Formats
* All effects: **PCM WAV, mono, 8-bit unsigned**; die/extralife/letsgo/pop/shh at **22 050 Hz**,
  extra/fruit/hell/hurry/jump/yippee at **11 025 Hz**.
* Music `music/Snd1..6-8.wav`: **mono 8-bit 44 100 Hz** (Snd2 244 s, Snd6 224 s, Snd3 43 s,
  Snd1 12 s, Snd5 11 s, Snd4 7.7 s). Extension musics 8-bit mono 44.1 kHz (ext6/ext7 22.05 kHz).
* Effects are panned by the sprite x: `pad = (x − 32)/(bwidth − 96)`, volume 0.8
  (images.py:42-46); pitch scaled by 1/frametime when game speed changes.

### 8.2 Effects (images.py:525-535, `Snd.<Name>` ← `sounds/<name>.wav`)
| Sound | Played when |
|---|---|
| `pop.wav` | any bubble pops; paddle/ship/pac destroyed; sheep explodes |
| `jump.wav` | dragon jumps (also sheep jump) |
| `die.wav` | dragon dies |
| `letsgo.wav` | a player joins |
| `extralife.wav` | extra life; EXTEND completed; game-over sequence start; Tetris 4-line |
| `fruit.wav` | default sound for picking up any bonus/fruit; Chestnut |
| `extra.wav` | Megabonus taken; Fruits bonus; catching 2+ dragons; sheep stomps monster; Pac-Man dot; lemming saved |
| `yippee.wav` | bonus inside a bubble popped; Sheep board-leave |
| `hurry.wav` | HURRY UP |
| `hell.wav` | monster becomes ghost (hurry), Carrot big, Monsterer big |
| `shh.wav` | teleport, BigFireBubble, superfruit, time-machine ghosts |

### 8.3 Music (images.py:536-541)
| Var | File | When |
|---|---|---|
| `music_intro` | Snd1 | intro jingle before Snd2 on boards with `(num+1) % 20 < 10` |
| `music_game` | Snd2 | main loop, boards 1-9, 20-29, 40-49, … (boards.py:51-56) |
| `music_game2` | Snd6 | loop for boards 10-19, 30-39, …; also the welcome/waiting screen |
| `music_potion` | Snd3 | potion fill and **game-over** screens |
| `music_modern` | Snd4 | board end with Wand/Chest Megabonus; prefix when a Cactus big bonus drops |
| `music_old` | Snd5 | EXTEND completed |
Leaving a board fades music out over 1.5 s unless a loop is set (boards.py:272-273). Music is
stopped when the ghost appears and restarted 200 frames later.

---------------------------------------------------------------------------------------------------

## 9. Game flow

* **Start / lobby** (`wait_for_one_player`, boards.py:492-565): text "Welcome to … Click on your
  Favorite Color's Dragon / Choose four keys: Right, Left, Jump, Shoot / and Let's Go!",
  random bubbles rising, music Snd6. A client clicks a colour (player slot 0-9) and binds 4 keys.
  Players may join or leave at any time; a leaving player's score is kept for 5 minutes
  (`KEEPALIVE`, player.py:12). Command line: `-b` begin board, `-s` step, `--final`,
  `-l` lives, `--extralife` (50 000), `--limitlives`, `-M` monster multiplier, `-i` auto-restart.
* **Board entry** (boards.py:72-226): new board walls/background start `bheight` px below and
  **scroll up 8 px/frame** into place; players shuffled and assigned to left/right start sides
  (balancing); dragons spawn bottom-left/right; monsters placed. Music per §8.3.
* **Normal play** (boards.py:701-741): runs until the monster list is empty (hurry-up logic §6.5,
  random bubbles/bonuses §5.4/§7.1).
* **Board clear** (`last_monster_killed`, boards.py:764-779 + `exit_board` 942-967): 8 frames,
  remaining monsters & random bonuses removed, every bubble popped one per frame (or turned into
  wand bonuses), Megabonus drop, then **390 more frames (~9.75 s)** of play to collect fruit,
  then `next_board` (+`stepboard`).
* **Board leave** (boards.py:270-308): active sprites removed one at a time in random order
  (0.9 frame each), then wall sprites in random order 4 per 0.32 frame, then 4 frames pause.
* **Final board** = first board with no monsters or index ≥ `finalboard` (boards.py:48):
  `bonus_play` (boards.py:827-854): **3:00 countdown** (180.9 s, shown top of panel, persists if
  re-entered); each frame 9.9 % `newbonusbubble()`: entry side random (bottom 30 %, top 30 %,
  left 20 %, right 20 %); 14 % a normal random bonus-bubble class, 2 % a captured random monster
  per dragon (MonsterBubble, timeout 100), else a **StarBubble** (pop → random bonus outcome +
  100 pts). Last 5 s slow-motion (frame time × √(5 s / remaining)). If a Wand/Chest is taken all
  bubbles convert, monsters die and the board restarts in place. When time reaches 0 →
  `End='gameover'`.
* **Game over** (boards.py:856-864, ranking.py:383-391): Extralife sound, music Snd3, endless
  cycle of 300-frame screens in a framed box: "THE END" score ranking (%), Best Monster Bubblers,
  Best Dragon Bubblers, Best Bonus Catchers, Best Bubble Exploders, Top Deaths, credits.
  There is **no persistent high-score table**. With `-i` the server resets after a 1:00 countdown
  once everybody stopped playing (boards.py:866-897).
* **Lives out**: if lives are limited and every playing player has 0 lives, `End = 1`; their panel
  icon shows "game over" (497); players can rejoin (score continues if kept).
* **Score panel** (player.py:1020-1206): x0 = bwidth; per player (sorted by score, bottom-up,
  56 px each): dragon icon at right, EXTEND letters at `x0 + l*15, y0 − 48`, score
  (player-coloured digits, 7 max) at `(x0+2, y0−18)`, lives (white, 2 digits) at `x0+7*CELL`,
  name (≤16 chars, font) at `y0−35`. Compressed vertically if it doesn't fit. Teams: names ending
  "(1)"/"(2)" join team 0/1, wear hats, team score summed.
* **Multiplayer**: up to 10 players (`images.MAX`), each a palette colour; dragons of other players
  can be trapped in bubbles (§5.5) but otherwise don't collide; points/extra lives per player.
