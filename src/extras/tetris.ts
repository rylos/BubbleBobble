// ext4 - Tetris: the level's walls collapse into a rugged floor (with pillars
// splitting long flat runs) and the dragons drop tetrominoes onto it. A line
// is complete when bricks span a whole gap between two walls: 500, 1000,
// 2000... points for successive lines of one drop. 90 seconds.

import type { Frame, Gfx } from '../engine/gfx';
import {
  Arena,
  CELL,
  COLS,
  FIELD_Y,
  ROWS,
  SPR,
  clamp,
  gauss,
  loadPlayerFrames,
  pick,
  rand,
  sec,
  shuffle,
  MiniGame,
  type GameMeta,
  type GameOptions,
  type Slot,
} from './common';
import type { App } from '../scenes';

export const TETRIS: GameMeta = {
  id: 'tetris',
  name: 'TETRIS',
  desc: 'FILL THE GAPS BETWEEN THE WALLS',
  mode: 'solo',
  time: 90,
  music: 'ext4',
  countLabel: 'LINES',
  controls: 'LEFT/RIGHT MOVE  JUMP ROTATE  FIRE/DOWN DROP',
};

type Pat = [number, number][];
const PATTERNS: Pat[] = [
  [[-2, 0], [-1, 0], [0, 0], [1, 0]],
  [[-2, 0], [-1, 0], [0, 0], [0, -1]],
  [[-1, -1], [-1, 0], [0, 0], [1, 0]],
  [[-1, 0], [0, 0], [0, -1], [1, 0]],
  [[-1, -1], [0, -1], [0, 0], [1, 0]],
  [[-2, 0], [-1, 0], [-1, -1], [0, -1]],
  [[-1, -1], [-1, 0], [0, -1], [0, 0]],
];

interface Brick {
  cx: number;
  cy: number;
  sx: number; // display position (pixels), eases towards the cell
  sy: number;
  p: number;
}

interface Piece {
  slot: Slot;
  pat: Pat;
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  bricks: Brick[];
  fallWait: number;
  moveWait: number;
  rotWait: number;
  ex: number; // eyes display position
  ey: number;
  look: number;
}

export class Tetris extends MiniGame {
  private arena!: Arena;
  private frames!: Frame[][];
  private statics = new Map<number, Brick>();
  private pieces: (Piece | null)[] = [];
  private next: Pat[] = [];
  private lastX: number[] = [];
  private builder: Generator<void> | null = null;
  private delays: number[] = [];

  constructor(app: App, opts: GameOptions) {
    super(app, TETRIS, opts);
    this.readyFrames = 99999;
    this.pieces = this.slots.map(() => null);
    this.next = this.slots.map(() => pick(PATTERNS));
    this.delays = this.slots.map(() => 0);
    this.lastX = this.slots.map((s) => (this.slots.length === 1 ? 16 : s.index === 0 ? 10 : 22));
  }

  protected async init(): Promise<void> {
    [this.arena, this.frames] = await Promise.all([Arena.load(this.app), loadPlayerFrames(this.app.gfx, 'ext4/image1_{p}.png', 16, 16)]);
    this.builder = this.build();
  }

  private key(x: number, y: number): number {
    return y * 64 + x;
  }
  private isStatic(x: number, y: number): boolean {
    return this.statics.has(this.key(x, y));
  }
  /** Solid for a falling piece: walls, landed bricks, the floor; above the board is free. */
  private solid(x: number, y: number, ignore: Piece | null = null): boolean {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y < 0) return false;
    if (this.arena.wall(x, y) || this.isStatic(x, y)) return true;
    for (const p of this.pieces) if (p && p !== ignore && p.bricks.some((b) => b.cx === x && b.cy === y)) return true;
    return false;
  }

  /** The original's board transformation: cap columns, add pillars, let walls fall. */
  private *build(): Generator<void> {
    const a = this.arena;
    const ymax = ROWS - 1;
    const maxh = Math.floor((ROWS * 3) / 4);
    const heights: number[] = new Array(COLS + 1).fill(0);
    heights[1] = ROWS;
    heights[COLS - 2] = ROWS;
    for (let x = 2; x < COLS - 2; x++) {
      a.set(x, ymax, true);
      let h = 1;
      for (let y = ymax - 1; y >= 0; y--)
        if (a.wall(x, y)) {
          if (h >= maxh) a.set(x, y, false);
          else h++;
        }
      heights[x] = h;
    }
    for (const x of shuffle(Array.from({ length: COLS - 4 }, (_, i) => i + 2))) {
      const h = heights[x];
      let x1 = x;
      let x2 = x;
      while (heights[x1 - 1] === h) x1--;
      while (heights[x2] === h) x2++;
      const parts = Math.floor((x2 - x1) / 8);
      if (!parts) continue;
      let left = 0;
      if (heights[x1 - 1] > h) {
        x1--;
        left++;
      }
      let right = parts + 1;
      if (heights[x2] > h) {
        x2++;
        right--;
      }
      for (let p = left; p < right; p++) {
        const px = x1 + Math.floor(((x2 - x1 - 1) * p + Math.floor(parts / 2)) / parts);
        let y = ymax;
        for (let i = 0; i < 2; i++) {
          while (a.wall(px, y)) y--;
          if (y >= 3) {
            a.set(px, y, true);
            heights[px]++;
          }
        }
      }
    }
    yield;
    let moves = true;
    let s = 8;
    while (moves) {
      moves = false;
      for (let y = ROWS - 3; y >= 0; y--)
        for (let x = 2; x < COLS - 2; x++)
          if (a.wall(x, y) && !a.wall(x, y + 1)) {
            let y0 = y;
            while (a.wall(x, y0 - 1)) y0--;
            a.set(x, y0, false);
            a.set(x, y + 1, true);
            moves = true;
          }
      if (moves) this.sfx('ext1_wall', 256);
      for (let i = 0; i < Math.floor(s) + 2; i++) yield;
      s *= 0.95;
    }
    this.readyFrames = this.phaseT + sec(1.2);
  }

  private positions(p: Piece, tx = p.tx, ty = p.ty, ox = p.ox, oy = p.oy): [number, number][] {
    const cx = tx * CELL - CELL / 2;
    const cy = ty * CELL - CELL / 2;
    return p.pat.map(([px, py]) => {
      const qx = px * CELL + CELL / 2;
      const qy = py * CELL + CELL / 2;
      return [Math.floor((cx + qx * ox - qy * oy) / CELL), Math.floor((cy + qx * oy + qy * ox) / CELL)];
    });
  }

  private fits(p: Piece, tx: number, ty: number, ox: number, oy: number): boolean {
    return this.positions(p, tx, ty, ox, oy).every(([x, y]) => !this.solid(x, y, p));
  }

  private place(p: Piece, tx: number, ty: number, ox: number, oy: number): boolean {
    if (!this.fits(p, tx, ty, ox, oy)) return false;
    p.tx = tx;
    p.ty = ty;
    p.ox = ox;
    p.oy = oy;
    this.positions(p).forEach(([x, y], i) => {
      p.bricks[i].cx = x;
      p.bricks[i].cy = y;
    });
    return true;
  }

  private spawn(slot: Slot): void {
    const pat = this.next[slot.index];
    this.next[slot.index] = pick(PATTERNS);
    const xmin = 2 - Math.min(...pat.map(([x]) => x));
    const xmax = COLS - 3 - Math.max(...pat.map(([x]) => x));
    const tx = clamp(Math.round(gauss(this.lastX[slot.index], 2)), xmin, xmax);
    const p: Piece = {
      slot,
      pat,
      tx,
      ty: -1,
      ox: 1,
      oy: 0,
      bricks: [],
      fallWait: 0,
      moveWait: 0,
      rotWait: 0,
      ex: (tx - 1) * CELL,
      ey: -3 * CELL,
      look: 0,
    };
    p.bricks = this.positions(p).map(([x, y]) => ({ cx: x, cy: y, sx: x * CELL, sy: (y - 2) * CELL, p: slot.index }));
    this.pieces[slot.index] = p;
  }

  /** Frames per row for normal falling: speeds up as the clock runs down. */
  private get fallDelay(): number {
    const f = 1 - this.timeLeft / sec(90);
    return Math.round(26 - 12 * f);
  }

  protected step(): void {
    if (this.builder && this.builder.next().done) this.builder = null;
    if (this.live)
      for (const s of this.slots) {
        if (s.out) continue;
        const p = this.pieces[s.index];
        if (!p) {
          if (--this.delays[s.index] <= 0) this.spawn(s);
        } else this.control(p);
      }
    // ease bricks towards their cells
    const ease = (b: Brick) => {
      b.sx += (b.cx * CELL - b.sx) * 0.3;
      b.sy += (b.cy * CELL - b.sy) * 0.3;
      if (Math.abs(b.cx * CELL - b.sx) < 0.5) b.sx = b.cx * CELL;
      if (Math.abs(b.cy * CELL - b.sy) < 0.5) b.sy = b.cy * CELL;
    };
    for (const p of this.pieces)
      if (p) {
        p.bricks.forEach(ease);
        p.ex += clamp((p.tx - 1) * CELL - p.ex, -6, 6);
        p.ey += clamp((p.ty - 1) * CELL - p.ey, -6, 6);
      }
    this.statics.forEach(ease);
  }

  private control(p: Piece): void {
    const pad = this.pad(p.slot);
    // sideways: immediate on press, then repeat every 8 frames
    const dx = pad.dx;
    p.look = dx;
    if (p.moveWait > 0) p.moveWait--;
    if (dx && (pad.pressed('left') || pad.pressed('right') || p.moveWait === 0)) {
      if (this.place(p, p.tx + dx, p.ty, p.ox, p.oy)) p.moveWait = pad.pressed('left') || pad.pressed('right') ? 12 : 6;
    }
    // rotate (with a small wall kick)
    if (p.rotWait > 0) p.rotWait--;
    if (pad.held.jump && (pad.pressed('jump') || p.rotWait === 0)) {
      const ox = p.oy;
      const oy = -p.ox;
      for (const k of [0, 1, -1, 2, -2])
        if (this.place(p, p.tx + k, p.ty, ox, oy)) {
          p.rotWait = 14;
          break;
        }
    }
    // falling
    const fast = pad.held.fire || pad.held.down;
    p.fallWait++;
    if (p.fallWait >= (fast ? 3 : this.fallDelay)) {
      p.fallWait = 0;
      if (!this.place(p, p.tx, p.ty + 1, p.ox, p.oy)) this.land(p);
      else if (fast) p.slot.score += 1;
    }
  }

  private land(p: Piece): void {
    this.pieces[p.slot.index] = null;
    this.lastX[p.slot.index] = p.tx;
    this.delays[p.slot.index] = 8;
    let topped = false;
    for (const b of p.bricks) {
      if (b.cy < 0) {
        topped = true;
        continue;
      }
      this.statics.set(this.key(b.cx, b.cy), b);
    }
    this.app.audio.sfx('ext1_wall', 0, { volume: 0.5, rate: 0.7 });
    const rows = p.bricks.filter((b) => b.cy >= 0).map((b) => [b.cx, b.cy] as [number, number]);
    rows.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let pts = 500;
    for (;;) {
      let cleared = false;
      for (const [px, py] of rows) {
        let x1 = px;
        while (this.isStatic(x1 - 1, py)) x1--;
        if (!this.arena.wall(x1 - 1, py)) continue;
        let x2 = px;
        while (this.isStatic(x2, py)) x2++;
        if (!this.arena.wall(x2, py)) continue;
        if (x2 - x1 < 2) continue;
        // full line between two walls
        p.slot.count++;
        for (let x = x1; x < x2; x++) {
          this.statics.delete(this.key(x, py));
          this.fx.anim(x * CELL + rand() * CELL - CELL, py * CELL + rand() * CELL - CELL, SPR.pop, 2);
        }
        this.give(p.slot, pts, ((x1 + x2) / 2) * CELL, py * CELL + 8);
        this.app.audio.sfx(pts === 500 ? 'fruit' : pts >= 4000 ? 'extralife' : 'extra');
        pts *= 2;
        // the bricks above (within the cleared span) drop one row
        for (let y = py - 1; y >= 0; y--) {
          let any = false;
          for (let x = x1; x < x2; x++) {
            const b = this.statics.get(this.key(x, y));
            if (!b) continue;
            any = true;
            this.statics.delete(this.key(x, y));
            b.cy = y + 1;
            this.statics.set(this.key(x, y + 1), b);
          }
          if (!any) break;
        }
        cleared = true;
        break;
      }
      if (!cleared) break;
    }
    if (topped) {
      p.slot.out = true;
      this.app.audio.sfx('die');
      this.fx.text(p.tx * CELL, 40, 'TOPPED OUT!', '#f66', 120);
      if (this.slots.every((s) => s.out)) this.finish('GAME OVER');
    }
  }

  protected render(g: Gfx): void {
    this.arena.draw(g);
    const fr = this.frames;
    // ghost (landing preview) for each falling piece
    for (const p of this.pieces) {
      if (!p) continue;
      let ty = p.ty;
      while (this.fits(p, p.tx, ty + 1, p.ox, p.oy)) ty++;
      if (ty === p.ty) continue;
      for (const [x, y] of this.positions(p, p.tx, ty, p.ox, p.oy))
        if (y >= 0) g.drawFrame(fr[p.slot.index][0], x * CELL, FIELD_Y + y * CELL, { alpha: 0.22 });
    }
    this.statics.forEach((b) => g.drawFrame(fr[b.p][1], b.sx, FIELD_Y + b.sy));
    for (const p of this.pieces) {
      if (!p) continue;
      for (const b of p.bricks) if (b.sy > -CELL) g.drawFrame(fr[b.p][0], b.sx, FIELD_Y + b.sy);
      g.draw(`eyes:${p.look}:0`, p.ex, FIELD_Y + p.ey, { alpha: 0.95 });
    }
  }

  protected drawHud(g: Gfx): void {
    super.drawHud(g);
    if (this.phase === 'loading') return;
    // next piece previews in the score bar
    for (const s of this.slots) {
      if (s.out) continue;
      const pat = this.next[s.index];
      const x0 = s.index === 0 ? 150 : 512 - 150 - 40;
      g.text('NEXT', x0 + 20, 2, '#888', { align: 'center', scale: 1 });
      for (const [px, py] of pat) g.drawFrame(this.frames[s.index][0], x0 + 16 + px * 8, 20 + py * 8, { scale: 0.5 });
    }
  }
}
