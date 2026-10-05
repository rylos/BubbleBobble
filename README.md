# Bubble Bobble DX

A web remake of the arcade **Bubble Bobble** (Taito, 1986) that merges the best of two fan projects:

- **The Bub's Brothers** (Armin Rigo, David Gowers, McSebi): high-resolution 32 px sprites, the 400 levels of the
  Mac *Bub & Bob* (4 sets of 100), the game logic (player physics, bubbles and winds, monsters, specials, bonuses,
  mini-games), sounds and music.
- **Julgen Bubble Bobble** (Julian Rijken, the project this repository was forked from): the arcade sound effects,
  *The Quest Begins* theme, the NES logo and font.

It is written from scratch in TypeScript (Canvas 2D + WebAudio, no engine) and runs in any modern browser, on
desktop and mobile (it can be added to the home screen as a full-screen app; it needs a connection, there is no
offline mode).

## Play

Requires Node.js 18+. The generated assets are committed, so playing needs no Python or source assets.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (deploy anywhere)
```

Menus: arrows to move, Enter / Space / Z / X to confirm, Esc to go back.

| | Player 1 | Player 2 |
|---|---|---|
| Move | ← → | A D |
| Jump | X / ↑ / Space | W / G |
| Bubble | Z / C / Ctrl | F / Q |
| Start / join | Enter / 1 | 2 |
| Pause | Esc / P | |

Gamepads: d-pad/stick, A jump, B/X bubble, Start. On phones on-screen buttons appear automatically.

## Features

- Arcade rules: 3 lives, extra life at 30 000 and every 100 000, EXTEND letters, fruit chains
  (1000 → 64 000), *Hurry up!* and the invincible Baron von Blubba, continues, 2 players co-op at any time,
  boss fight on round 100, high-score table with initials.
- 4 level sets × 100 rounds (*Bub & Bob*, *Lost Levels*, *House of Fun*, *Arena*), choose the starting round.
- Wind currents, vertical wrap-around, bubble riding, chain pops, fire / water / thunder bubbles.
- 30+ bonus items (speed shoe, rapid fire, special bubbles, crosses, umbrellas that skip rounds, potions,
  clock, ring, book of stars, bomb, extend...).
- Extra games from The Bub's Brothers (Arkanoid, Tetris, Pac-Man, Galaga, Lemmings, Tron, biplanes).
- CRT filter, volume settings, fullscreen.

## Source projects

| Project | What it gave | Where |
|---|---|---|
| The Bub's Brothers 1.6.2 (Python) | sprites, levels, game logic, mini-games, Mac sounds and music | http://bub-n-bros.sourceforge.net/ — tarball `bubbros-1.6.2.tar.gz`; technical notes in `docs/bubbros-spec.md` |
| Julgen Bubble Bobble (C++) | arcade sound effects, *The Quest Begins*, NES logo and font | https://github.com/JulianRijken/BubbleBobble (engine https://github.com/JulianRijken/Julgen); the old C++ code is in this repo's history at commit `6a59ee9`; notes in `docs/julgen-spec.md` |

`CLAUDE.md` summarises where to look in each project and the conventions used here.

## Assets pipeline

Only needed to regenerate `public/assets/`. The original assets are converted by the Python tools in `tools/`
(needs Python 3 with numpy + Pillow, and ffmpeg). The Julgen assets are already in `assets-src/julgen/`; The Bub's
Brothers must be extracted (it is gitignored):

```sh
tar xzf bubbros-1.6.2.tar.gz -C assets-src   # from http://bub-n-bros.sourceforge.net/
npm run assets                                # = python3 tools/build_all.py
```

| Tool | Output |
|---|---|
| `build_sprites.py` | `public/assets/sprites/*.png` (PPM → PNG with alpha, player colours from `palettes.dat`) and `sprites.json` (sprite id → sheet rect, same ids as The Bub's Brothers) |
| `build_levels.py` | `public/assets/levels/<set>.json` (walls, winds, monsters, flags) and per-level wall layers with arcade drop shadows, decoded from the Mac resource forks |
| `build_audio.py` | `public/assets/audio/` cleaned OGG effects and music with seamless loop points, `audio.json` (see `tools/audio_identification.md`) |
| `build_font.py` | `public/assets/sprites/font.png` bitmap font from the NES TTF |

`node tools/shot.mjs <url> <outdir> "<steps>"` drives the game in headless Chromium and saves screenshots
(used for testing; in dev builds the running game is exposed as `window.bb`).

## Code map

```
src/engine/   gfx (sprites, bitmap font), input (keyboard/gamepad/touch), audio (WebAudio)
src/game/     world (round flow and rules), level, dragon, bubble, monster, items, specials, boss, hud
src/extras/   mini-games
src/scenes.ts title, intro, game, name entry, high scores, options
tools/        asset pipeline (Python) and headless test runner
docs/         technical notes on the two source projects
```

## Credits and licenses

- Bubble Bobble © 1986 Taito. This is a non-commercial fan project.
- The Bub's Brothers code © 2003-2005 Armin Rigo (MIT); graphics by David Gowers based on McSebi's;
  sounds, music and levels from *Bub & Bob 1* by Sebastian Wegner (McSebi), released under the revised Artistic
  License.
- Julgen Bubble Bobble © Julian Rijken, GPL-3.0.
- This remake is distributed under the GNU GPL v3 (see `LICENSE.md`).
