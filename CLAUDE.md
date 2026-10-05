# Bubble Bobble DX

Web remake of arcade Bubble Bobble in TypeScript (Canvas 2D + WebAudio, Vite). See README.md for commands,
features and the code map.

## Source projects (go back to these when you need details)

The game is built from two earlier projects. Before guessing how something should behave or look, check them.

### 1. The Bub's Brothers 1.6.2 (Python, Armin Rigo / David Gowers / McSebi)
Source of the sprites, the 4 Mac level sets, almost all game logic (player physics, bubbles, winds, monsters,
bonuses, mini-games), Mac sounds and music.
- Home page: http://bub-n-bros.sourceforge.net/
- Tarball: `~/Downloads/bubbros-1.6.2.tar.gz`; extracted (gitignored) in `assets-src/bubbros-1.6.2/`.
  Re-extract with `tar xzf ~/Downloads/bubbros-1.6.2.tar.gz -C assets-src` if missing.
- Key files in `bubbob/`: `player.py` (dragon), `bubbles.py`, `monsters.py`, `bonuses.py`, `boards.py`
  (round flow, geometry), `mnstrmap.py` + `sprmap.py` (sprite ids), `macbinary.py`/`binboards.py` (level
  format), `ext1..ext7/` (mini-games), `images/`, `sounds/`, `music/`, `levels/*.bin`.
- Technical spec with file:line references: `docs/bubbros-spec.md`.

### 2. Julgen Bubble Bobble (C++, Julian Rijken) — the project this repo was forked from
Source of the arcade sound effects, "The Quest Begins" theme, the NES logo and font (`assets-src/julgen/`).
- Upstream: https://github.com/JulianRijken/BubbleBobble (engine: https://github.com/JulianRijken/Julgen)
- The old C++ code is in this repo's history: commit `6a59ee9` (last commit before the remake).
  Browse it with `git show 6a59ee9:src/...` or `git worktree add /tmp/julgen-old 6a59ee9`.
- Analysis of that code (architecture, bugs, build): `docs/julgen-spec.md`.

## Conventions
- Sprite ids are The Bub's Brothers sprmap ids (`public/assets/sprites/sprites.json`); `{p}` sheets are per
  player colour.
- Logic runs at a fixed 60 Hz with Bub's Brothers per-frame constants (the original ran at 40 Hz).
- Generated assets in `public/assets/` come from `tools/*.py`; regenerate with `npm run assets`, don't edit by hand
  (except `audio/audio.json` sound mapping, see `tools/audio_identification.md`).
- Test headlessly with `node tools/shot.mjs <url> <outdir> "<steps>"` (dev builds expose the world as `window.bb`).
