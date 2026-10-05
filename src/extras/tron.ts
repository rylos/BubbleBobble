// ext6 - Tron: light-cycles on an 8-px grid enter through gates in the top
// and bottom walls; no 180-degree turns. The last cycle running wins the
// round (+1, +100 points). Rounds repeat for 60 seconds. Solo play is
// against a CPU rider.

import type { Frame, Gfx } from '../engine/gfx';
import {
  Arena,
  COLS,
  DirInput,
  FIELD_Y,
  PCOLORS,
  ROWS,
  SPR,
  loadPlayerFrames,
  rand,
  randInt,
  sec,
  MiniGame,
  type Dir,
  type GameMeta,
  type GameOptions,
  type Slot,
} from './common';
import type { App } from '../scenes';

export const TRON: GameMeta = {
  id: 'tron',
  name: 'TRON',
  desc: 'LIGHT CYCLES: BE THE LAST ONE RIDING',
  mode: 'versus',
  time: 60,
  music: 'ext6',
  countLabel: 'ROUNDS',
  controls: 'ARROWS TURN  (NO U-TURNS)',
};

const GW = COLS * 2;
const GH = ROWS * 2;
const X0 = 5;
const X1 = GW - 4; // exclusive
const Y0 = 3;
const Y1 = GH - 2; // exclusive
const STEP = 3; // frames per grid step

interface Head {
  slot: Slot;
  cx: number;
  cy: number;
  dir: Dir;
  alive: boolean;
  entered: boolean;
  queued: Dir | null;
  input: DirInput;
}

interface Trail {
  cx: number;
  cy: number;
  icon: number;
  p: number;
}

// trail icon rows in the 8x80 sheet: key = old dir + new dir
const TRAIL: Record<string, number> = {
  '0,-1,1,0': 4,
  '0,1,1,0': 5,
  '1,0,0,-1': 6,
  '1,0,0,1': 7,
  '1,0,1,0': 8,
  '0,1,0,1': 9,
};
for (const [k, v] of Object.entries({ ...TRAIL })) {
  const [a, b, c, d] = k.split(',').map(Number);
  TRAIL[[-c, -d, -a, -b].join(',')] = v;
}
const HEAD: Record<string, number> = { '0,-1': 0, '-1,0': 1, '0,1': 2, '1,0': 3 };

export class Tron extends MiniGame {
  private arena!: Arena;
  private frames!: Frame[][];
  private free = new Uint8Array(GW * GH);
  private heads: Head[] = [];
  private trails: Trail[] = [];
  private roundT = 0;
  private roundState: 'wait' | 'run' | 'over' = 'wait';
  private roundWinner: Slot | null | undefined = undefined;
  private round = 0;

  constructor(app: App, opts: GameOptions) {
    super(app, TRON, opts);
    this.readyFrames = sec(1.8);
  }

  protected async init(): Promise<void> {
    [this.arena, this.frames] = await Promise.all([Arena.load(this.app), loadPlayerFrames(this.app.gfx, 'ext6/image1_{p}.png', 8, 8)]);
    this.arena.clear(2, COLS - 2, 1, ROWS - 1);
    this.newRound();
  }

  private newRound(): void {
    const a = this.arena;
    for (const y of [0, ROWS - 1]) for (let x = 2; x < COLS - 2; x++) a.set(x, y, true);
    this.free.fill(0);
    for (let x = X0; x < X1; x++) for (let y = Y0; y < Y1; y++) this.free[y * GW + x] = 1;
    this.trails = [];
    this.heads = [];
    this.roundState = 'wait';
    this.roundT = 0;
    this.roundWinner = undefined;
    this.round++;
    for (const s of this.slots) this.spawn(s);
  }

  private spawn(slot: Slot): void {
    // gates along the top and bottom walls, as far as possible from the others
    let best: { x: number; y: number; dir: Dir } | null = null;
    let bd = -1;
    for (let k = 0; k < 40; k++) {
      const x = 4 + randInt(COLS - 7);
      const top = rand() < 0.5;
      const y = top ? 0 : ROWS - 1;
      let d = 99;
      for (const h of this.heads) d = Math.min(d, Math.abs(x - (h.cx >> 1)) + Math.abs(y - (h.cy >> 1)));
      if (this.heads.length && this.heads[0].cy < 0 === top) d -= 6; // prefer opposite sides
      if (d > bd) {
        bd = d;
        best = { x, y, dir: [0, top ? 1 : -1] };
      }
    }
    const { x, y, dir } = best!;
    this.arena.set(x, y, false);
    const cx = 2 * x + 1;
    let cy = 2 * y - dir[1];
    if (dir[1] < 0) cy += 2;
    this.heads.push({ slot, cx, cy, dir, alive: true, entered: false, queued: null, input: new DirInput() });
  }

  private isFree(x: number, y: number): boolean {
    return x >= 0 && x < GW && y >= 0 && y < GH && this.free[y * GW + x] === 1;
  }

  protected step(): void {
    if (this.phase === 'play' && this.phaseT === 0) this.roundT = 0;
    this.roundT++;
    if (this.roundState === 'over') {
      if (this.roundT > sec(1.6) && this.live) this.newRound();
      return;
    }
    // input is sampled every frame so quick taps are not lost
    for (const h of this.heads) {
      if (!h.alive || h.slot.cpu || !this.live) continue;
      const pad = this.pad(h.slot);
      const d = h.input.update(pad);
      for (const [b, dx, dy] of [
        ['left', -1, 0],
        ['right', 1, 0],
        ['up', 0, -1],
        ['down', 0, 1],
      ] as const)
        if (pad.pressed(b)) h.queued = [dx, dy];
      if (!h.queued && d) h.queued = d;
    }
    if (!this.live || this.roundT < sec(0.4) || this.roundT % STEP) return;
    this.roundState = 'run';
    const crashed: Head[] = [];
    for (const h of this.heads) {
      if (!h.alive) continue;
      let nd = h.dir;
      if (h.entered) {
        if (h.slot.cpu) nd = this.think(h);
        else if (h.queued) nd = h.queued;
        if (nd[0] === -h.dir[0] && nd[1] === -h.dir[1]) nd = h.dir;
      }
      h.queued = null;
      this.trails.push({ cx: h.cx, cy: h.cy, icon: TRAIL[[...h.dir, ...nd].join(',')] ?? 8, p: h.slot.index });
      h.dir = nd;
      h.cx += nd[0];
      h.cy += nd[1];
      if (!h.entered) {
        if (this.isFree(h.cx, h.cy)) {
          h.entered = true;
          this.free[h.cy * GW + h.cx] = 0;
        }
        continue;
      }
      if (!this.isFree(h.cx, h.cy)) crashed.push(h);
    }
    // occupy after everybody moved (head-on collisions kill both)
    for (const h of this.heads) {
      if (!h.alive || !h.entered || crashed.includes(h)) continue;
      if (this.heads.some((o) => o !== h && o.alive && o.cx === h.cx && o.cy === h.cy)) crashed.push(h);
      else this.free[h.cy * GW + h.cx] = 0;
    }
    for (const h of crashed) {
      h.alive = false;
      this.sfx('ext6_crash', h.cx * 8);
      this.fx.anim(h.cx * 8 - 2 + 4 - 16, h.cy * 8 - 2 + 4 - 16, [...SPR.explosion, ...SPR.explosion], 5);
    }
    const alive = this.heads.filter((h) => h.alive);
    if (crashed.length && alive.length <= 1) {
      this.roundState = 'over';
      this.roundT = 0;
      if (alive.length === 1) {
        const s = alive[0].slot;
        s.count++;
        this.give(s, 100, alive[0].cx * 8, alive[0].cy * 8 - 16);
        this.app.audio.sfx('yippee');
        this.roundWinner = s;
      } else this.roundWinner = null;
    }
  }

  /** CPU rider: pick the turn with the most room, preferring to go straight and to cut off the player. */
  private think(h: Head): Dir {
    const opts: Dir[] = [h.dir, [h.dir[1], -h.dir[0]], [-h.dir[1], h.dir[0]]];
    const foe = this.heads.find((o) => o !== h && o.alive);
    let best = h.dir;
    let bs = -Infinity;
    for (const d of opts) {
      const nx = h.cx + d[0];
      const ny = h.cy + d[1];
      if (!this.isFree(nx, ny)) continue;
      let s = this.room(nx, ny, 260) * 10;
      if (d === h.dir) s += 25;
      if (foe) {
        // don't move next to where the foe could be next step (head-on), but stay close
        const fx = foe.cx + foe.dir[0];
        const fy = foe.cy + foe.dir[1];
        if (Math.abs(nx - fx) + Math.abs(ny - fy) <= 1) s -= 400;
        s -= (Math.abs(nx - foe.cx) + Math.abs(ny - foe.cy)) * 0.8;
      }
      s += rand() * 30;
      if (s > bs) {
        bs = s;
        best = d;
      }
    }
    return best;
  }

  /** Flood fill size (capped) from a free cell. */
  private room(x: number, y: number, cap: number): number {
    const seen = new Set<number>([y * GW + x]);
    const q = [y * GW + x];
    while (q.length && seen.size < cap) {
      const k = q.shift()!;
      const cx = k % GW;
      const cy = Math.floor(k / GW);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = (cy + dy) * GW + cx + dx;
        if (!seen.has(n) && this.isFree(cx + dx, cy + dy)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    return seen.size;
  }

  protected render(g: Gfx): void {
    // grid floor
    g.rect(X0 * 8 - 2, FIELD_Y + Y0 * 8 - 2, (X1 - X0) * 8, (Y1 - Y0) * 8, '#000814');
    g.ctx.globalAlpha = 0.5;
    g.ctx.fillStyle = '#0b2a4a';
    for (let x = X0; x <= X1; x += 4) g.ctx.fillRect(x * 8 - 2, FIELD_Y + Y0 * 8 - 2, 1, (Y1 - Y0) * 8);
    for (let y = Y0; y <= Y1; y += 4) g.ctx.fillRect(X0 * 8 - 2, FIELD_Y + y * 8 - 2, (X1 - X0) * 8, 1);
    g.ctx.globalAlpha = 1;
    this.arena.draw(g);
    for (const t of this.trails) g.drawFrame(this.frames[t.p][t.icon], t.cx * 8 - 2, FIELD_Y + t.cy * 8 - 2);
    for (const h of this.heads) {
      if (!h.alive && this.roundState !== 'over') continue;
      g.drawFrame(this.frames[h.slot.index][HEAD[h.dir.join(',')]], h.cx * 8 - 2, FIELD_Y + h.cy * 8 - 2, { alpha: h.alive ? 1 : 0.5 });
      if (h.alive && !h.entered && this.roundT < sec(1.5) && (this.t >> 3) & 1) {
        const label = h.slot.cpu ? 'CPU' : `P${h.slot.index + 1}`;
        g.text(label, h.cx * 8 + 2, FIELD_Y + (h.dir[1] > 0 ? 24 : 360), PCOLORS[h.slot.index], { align: 'center', scale: 1.5 });
      }
    }
    if (this.roundState === 'over' && this.roundWinner !== undefined) {
      const w = this.roundWinner;
      const txt = w ? `${w.cpu ? 'CPU' : `PLAYER ${w.index + 1}`} WINS ROUND` : 'BOTH CRASHED!';
      g.text(txt, 256, FIELD_Y + 180, w ? PCOLORS[w.index] : '#ccc', { align: 'center' });
    } else if (this.live && this.roundT < sec(0.8)) g.text(`ROUND ${this.round}`, 256, FIELD_Y + 180, '#ff5', { align: 'center' });
  }

}
