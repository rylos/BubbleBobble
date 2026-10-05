// ext5 - Lemmings: dozens of lemmings pop up on every ledge and wander off,
// climbing one-cell steps and splatting after long falls. Bubble them and the
// bubble carries them out through the open ceiling: +1 and 500 points each.
// The dragon also works as a blocker (lemmings turn around in front of it).

import type { Frame, Gfx } from '../engine/gfx';
import type { Level } from '../game/level';
import {
  Arena,
  CELL,
  COLS,
  FIELD_H,
  FIELD_W,
  FIELD_Y,
  ROWS,
  SPR,
  loadFrames,
  sec,
  MiniGame,
  type GameMeta,
  type GameOptions,
  type Slot,
} from './common';
import type { App } from '../scenes';

export const LEMMINGS: GameMeta = {
  id: 'lemmings',
  name: 'LEMMINGS',
  desc: 'BUBBLE THE LEMMINGS TO SAFETY',
  mode: 'solo',
  time: 60,
  music: 'ext5',
  countLabel: 'SAVED',
  controls: 'ARROWS WALK  JUMP  FIRE BUBBLE',
};

const GRAVITY = 0.21;
const JUMP = 7.5;
const APEX = 4;
const FIRE_COOL = 16;
const WALK_EVERY = 5; // frames per 2-px lemming step
const SPLAT_FALL = 44; // fall steps (4 px each) a lemming survives

interface Dragon {
  slot: Slot;
  x: number;
  y: number;
  dir: number;
  up: number;
  yfp: number;
  walk: number;
  fire: number;
  air: boolean;
}

interface Bubble {
  slot: Slot;
  x: number;
  y: number;
  nx: number;
  hspeed: number;
  shot: boolean;
  age: number;
  lem: Lem | null;
  life: number;
}

type LemState = 'walk' | 'climb' | 'fall' | 'splat' | 'jailed' | 'gone';

interface Lem {
  x: number;
  y: number;
  dir: number;
  state: LemState;
  n: number; // animation / fall counter
  tick: number;
  climbTo: number;
}

export class Lemmings extends MiniGame {
  private arena!: Arena;
  private lv!: Level;
  private walkR!: Frame[];
  private walkL!: Frame[];
  private crash!: Frame[];
  private jail!: Frame[];
  private dragons: Dragon[] = [];
  private bubbles: Bubble[] = [];
  private lems: Lem[] = [];
  private builder: Generator<void> | null = null;
  private total = 0;
  private lost = 0;

  constructor(app: App, opts: GameOptions) {
    super(app, LEMMINGS, opts);
    this.readyFrames = 99999;
  }

  protected async init(): Promise<void> {
    const g = this.app.gfx;
    const [arena, r, l, c, j] = await Promise.all([
      Arena.load(this.app),
      loadFrames(g, 'ext5/image1.png', 32, 32),
      loadFrames(g, 'ext5/image2.png', 32, 32),
      loadFrames(g, 'ext5/image3.png', 32, 32),
      loadFrames(g, 'ext5/image4.png', 32, 32),
    ]);
    this.arena = arena;
    this.lv = arena.level;
    this.walkR = r;
    this.walkL = l;
    this.crash = c;
    this.jail = j;
    this.builder = this.build();
  }

  /** Original bget(): outside x is wall, outside y reads row 0. */
  private bget(x: number, y: number): boolean {
    return this.lv.wall(x, y);
  }

  private *build(): Generator<void> {
    const a = this.arena;
    const ymax = ROWS - 1;
    let holes = 0;
    for (let x = 2; x < COLS - 2; x++) if (!a.wall(x, ymax)) holes++;
    // columns from the sides inwards
    const xs: number[] = [];
    for (let d = 2; d < COLS; d++) {
      const pair = [d, COLS - d - 1];
      if (pair.some((x) => xs.includes(x))) break;
      xs.push(...pair);
    }
    for (const x of xs) {
      if (holes > 2 && !a.wall(x, ymax)) {
        a.set(x, ymax, true);
        holes--;
      }
      for (let y = 0; y < ymax; y++) {
        if (!a.wall(x, y)) break;
        a.set(x, y, false);
      }
      yield;
    }
    // dragons
    for (const s of this.slots) {
      const p = this.groundSpot(s.index === 0);
      this.dragons.push({ slot: s, x: p.x, y: p.y, dir: s.index === 0 ? 1 : -1, up: 0, yfp: 0, walk: 0, fire: 0, air: false });
    }
    // lemmings appear on every ledge, scanning down the columns
    const testing = new Map<number, number>();
    const scan = () => {
      for (const [x, y] of [...testing]) {
        if (this.bget(x, y) && !this.bget(x, y - 1)) {
          this.lems.push({ x: x * CELL - CELL / 2, y: (y - 2) * CELL, dir: x <= COLS / 2 ? 1 : -1, state: 'walk', n: 0, tick: 0, climbTo: 0 });
          this.total++;
        }
        if (y < ymax) testing.set(x, y + 1);
        else testing.delete(x);
      }
    };
    for (const x of xs) {
      testing.set(x, 1);
      scan();
      if (x % 3 === 0) yield;
    }
    while (testing.size) {
      scan();
      yield;
    }
    this.readyFrames = this.phaseT + sec(0.8);
  }

  private groundSpot(left: boolean): { x: number; y: number } {
    for (let cy = ROWS - 3; cy > 0; cy--)
      for (let i = 2; i < COLS - 3; i++) {
        const cx = left ? i : COLS - 2 - i;
        const x = cx * CELL;
        const y = cy * CELL;
        if (this.lv.free(x, y) && this.lv.onGround(x, y)) return { x, y };
      }
    return { x: left ? 64 : FIELD_W - 96, y: FIELD_H - 64 };
  }

  protected step(): void {
    if (this.builder && this.builder.next().done) this.builder = null;
    for (const d of this.dragons) this.updateDragon(d);
    for (const b of this.bubbles) this.updateBubble(b);
    this.bubbles = this.bubbles.filter((b) => b.life > 0);
    if (this.live) for (const l of this.lems) this.updateLem(l);
    this.lems = this.lems.filter((l) => l.state !== 'gone');
    if (this.live && !this.builder && !this.lems.length) {
      const secs = Math.ceil(this.timeLeft / 60);
      for (const s of this.slots) if (s.count) s.score += secs * 100;
      this.finish(this.slots.some((s) => s.count) ? 'ALL LEMMINGS GONE' : 'NO SURVIVORS');
    }
  }

  // --- dragon -----------------------------------------------------------------------------

  private updateDragon(d: Dragon): void {
    const lv = this.lv;
    const pad = this.pad(d.slot);
    const live = this.live;
    const go = live ? pad.dx : 0;
    if (go) d.dir = go;
    if (d.x & 1) d.x += d.dir;
    if (go && lv.canWalk(d.x, d.y, go)) {
      d.x += 2 * go;
      d.walk = (d.walk + 1) % 12;
    }
    if (d.up) {
      d.up -= GRAVITY;
      if (d.up < APEX) d.up = 0;
      else {
        const ny = d.y + d.yfp - d.up;
        d.y = Math.trunc(ny);
        d.yfp = ny - d.y;
        d.y = lv.warpY(d.y);
      }
      d.air = true;
    } else if (lv.onGround(d.x, d.y)) {
      d.air = false;
      if (live && pad.held.jump) {
        d.up = JUMP;
        d.yfp = 0;
        this.sfx('jump', d.x);
      }
    } else {
      d.air = true;
      let nx = d.x;
      if (nx < 32) nx += 2;
      else if (nx > lv.pw - 64) nx -= 2;
      d.x = nx;
      d.y = lv.warpY((d.y + 2) & ~1);
    }
    if (d.fire > 0) d.fire--;
    if (live && pad.pressed('fire') && d.fire === 0) {
      d.fire = FIRE_COOL;
      const x = d.x + 16 * d.dir;
      this.bubbles.push({ slot: d.slot, x, y: d.y, nx: x, hspeed: 8 * d.dir, shot: true, age: 0, lem: null, life: sec(9) });
      this.sfx('shoot', d.x);
    }
  }

  // --- bubbles ------------------------------------------------------------------------------

  private updateBubble(b: Bubble): void {
    b.age++;
    b.life--;
    if (!b.lem) {
      // shot bubbles and empty floating ones both catch lemmings
      const r = b.shot ? 23 : 18;
      const hit = this.lems.find((l) => (l.state === 'walk' || l.state === 'climb' || l.state === 'fall') && Math.abs(l.x - b.x) < r && Math.abs(l.y - b.y) < r);
      if (hit) {
        hit.state = 'jailed';
        b.lem = hit;
        b.life = sec(30);
        b.shot = false;
        this.sfx('capture', b.x);
        return;
      }
    }
    if (b.shot) {
      if (Math.abs(b.hspeed) >= 4) {
        b.nx += b.hspeed;
        b.hspeed *= 0.94;
        const xc = Math.floor((b.nx - 3.8) / CELL) + 1;
        const yc = Math.floor((b.y + 8) / CELL);
        if (this.lv.wall(xc, yc) && this.lv.wall(xc, yc + 1)) b.hspeed = 0;
        else b.x = Math.round(b.nx);
        return;
      }
      b.shot = false;
    }
    // float towards the open ceiling along the shortest free path
    const sp = b.lem ? 1.5 : 1.1;
    const cx = Math.round(b.x / CELL);
    const cy = Math.round(b.y / CELL);
    const here = this.flowAt(cx, cy);
    let tx = cx;
    let ty = cy - 1;
    if (here !== Infinity) {
      let best = here;
      for (const [dx, dy] of [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ]) {
        const v = this.flowAt(cx + dx, cy + dy);
        if (v < best) {
          best = v;
          tx = cx + dx;
          ty = cy + dy;
        }
      }
    }
    const ddx = tx * CELL - b.x;
    const ddy = ty * CELL - b.y;
    const len = Math.hypot(ddx, ddy) || 1;
    b.x += (ddx / len) * Math.min(sp, len);
    b.y += (ddy / len) * Math.min(sp, len);
    if (b.lem) {
      b.lem.x = b.x + Math.sin(b.age / 9) * 2;
      b.lem.y = b.y;
    }
    if (b.y < -32) {
      b.life = 0;
      if (b.lem) {
        b.lem.state = 'gone';
        b.slot.count++;
        this.give(b.slot, 500, b.x + 16, 24);
        this.sfx('extra', b.x);
      }
    } else if (b.life <= 0) {
      // the bubble bursts: the lemming drops out
      this.fx.anim(b.x, b.y, SPR.pop, 2);
      this.sfx('pop', b.x);
      if (b.lem) {
        b.lem.state = 'fall';
        b.lem.n = 0;
        b.lem.y &= ~3;
      }
    }
  }

  /** Distance (in cells) from a 2x2 bubble position to the top exit; Infinity when walled in. */
  private flow: Float32Array | null = null;
  private flowAt(cx: number, cy: number): number {
    if (cx < 0 || cx > COLS - 2 || cy < -2 || cy > ROWS - 2) return Infinity;
    if (!this.flow) this.buildFlow();
    return this.flow![(cy + 2) * COLS + cx];
  }
  private buildFlow(): void {
    const H = ROWS + 1;
    const f = new Float32Array(COLS * H).fill(Infinity);
    const free = (cx: number, cy: number) =>
      cx >= 1 && cx <= COLS - 3 && cy >= -2 && cy <= ROWS - 2 && !this.arena.wall(cx, cy) && !this.arena.wall(cx + 1, cy) && !this.arena.wall(cx, cy + 1) && !this.arena.wall(cx + 1, cy + 1);
    const q: [number, number][] = [];
    for (let cx = 1; cx <= COLS - 3; cx++) {
      f[cx] = 0;
      q.push([cx, -2]);
    }
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      const d = f[(y + 2) * COLS + x];
      for (const [dx, dy] of [
        [0, 1],
        [-1, 0],
        [1, 0],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!free(nx, ny)) continue;
        const k = (ny + 2) * COLS + nx;
        if (f[k] !== Infinity) continue;
        f[k] = d + 1;
        q.push([nx, ny]);
      }
    }
    this.flow = f;
  }

  // --- lemmings --------------------------------------------------------------------------------

  private onGround(l: Lem): boolean {
    if (l.y & 15) return false;
    const x0 = Math.floor((l.x + 15) / CELL);
    const y0 = Math.floor(l.y / CELL) + 2;
    return this.bget(x0, y0) && !this.bget(x0, y0 - 1);
  }

  private updateLem(l: Lem): void {
    l.tick++;
    switch (l.state) {
      case 'walk': {
        // the dragon blocks the way
        for (const d of this.dragons) {
          const dx = Math.abs(l.x - d.x);
          if (dx >= 14 && dx <= 20 && Math.abs(l.y - d.y) < 20) l.dir = l.x < d.x ? -1 : 1;
        }
        if (l.tick % WALK_EVERY) return;
        const y0 = Math.floor(l.y / CELL);
        const nx = l.x + l.dir * 2;
        const x0 = Math.floor((nx + 15) / CELL);
        if (!this.bget(x0, y0 + 1)) {
          if (!this.bget(x0, y0 + 2)) {
            l.state = 'fall';
            l.n = 0;
          }
        } else if (this.bget(x0, y0)) {
          l.dir = -l.dir;
          return;
        } else {
          l.state = 'climb';
          l.climbTo = (y0 - 1) * CELL;
        }
        l.x = nx;
        l.n++;
        return;
      }
      case 'climb':
        l.y -= 1;
        if (l.tick % 4 === 0) l.n++;
        if (l.y <= l.climbTo) {
          l.y = l.climbTo;
          l.state = 'walk';
        }
        return;
      case 'fall':
        if (this.onGround(l)) {
          if (l.n <= SPLAT_FALL) {
            l.state = 'walk';
            l.n = 0;
          } else {
            l.state = 'splat';
            l.n = 0;
            this.lost++;
            this.sfx('ext5_ouch', l.x);
          }
          return;
        }
        if (l.tick % 3) return;
        l.y = (l.y + 4) & ~3;
        l.n++;
        if (l.y >= FIELD_H) {
          l.state = 'gone';
          this.lost++;
        }
        return;
      case 'splat':
        if (++l.n >= 16 * 3) l.state = 'gone';
        return;
    }
  }

  // --- drawing ------------------------------------------------------------------------------------

  protected render(g: Gfx): void {
    this.arena.draw(g);
    for (const l of this.lems) {
      if (l.state === 'jailed') continue;
      const y = FIELD_Y + l.y;
      if (l.state === 'splat') g.drawFrame(this.crash[Math.min(15, Math.floor(l.n / 3))], l.x, y);
      else if (l.state === 'fall') {
        const f = l.n & 3;
        g.drawFrame(l.dir > 0 ? this.walkR[8 + f] : this.walkL[3 - f], l.x, y);
      } else {
        const f = l.n & 7;
        g.drawFrame(l.dir > 0 ? this.walkR[f] : this.walkL[11 - f], l.x, y);
      }
    }
    for (const d of this.dragons) {
      const left = d.dir < 0;
      let id: number;
      if (d.fire > FIRE_COOL - 10) id = 210 + (left ? 6 : 8) + (d.fire > FIRE_COOL - 5 ? 0 : 1);
      else if (d.air) id = d.up ? 683 + (left ? 2 : 3) : 683 + (left ? 0 : 1);
      else id = 210 + (left ? 0 : 3) + (this.live && this.pad(d.slot).dx ? Math.floor(d.walk / 4) : 0);
      g.draw(id, d.x, FIELD_Y + d.y, { p: d.slot.index });
    }
    for (const b of this.bubbles) {
      const y = FIELD_Y + b.y;
      if (b.lem) g.drawFrame(this.jail[Math.floor(b.age / 8) % 3], b.lem.x, y);
      const id = b.shot ? SPR.newBubble[Math.min(3, Math.floor(b.age / 3))] : SPR.bubble(this.t + b.age);
      g.draw(id, b.x, y, { p: b.slot.index, alpha: b.lem ? 0.75 : 0.9 });
    }
  }

  protected countText(s: Slot): string {
    return `SAVED ${s.count}`;
  }

  protected drawHud(g: Gfx): void {
    super.drawHud(g);
    if (this.phase === 'loading') return;
    const left = this.lems.filter((l) => l.state !== 'splat').length;
    g.text(`ALIVE ${left}  LOST ${this.lost}`, FIELD_W / 2, FIELD_Y + FIELD_H + 3, '#ccc', { align: 'center', scale: 1.5 });
  }
}
