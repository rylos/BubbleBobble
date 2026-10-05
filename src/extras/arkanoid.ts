// ext1 - Arkanoid: the level's upper half becomes a brick wall, the dragon turns
// into a paddle and bounces its own bubble. 60 seconds; a brick hit scores
// 125 x 2^bricks (the ball breaks up to three bricks at once).

import type { Frame, Gfx } from '../engine/gfx';
import {
  Arena,
  CELL,
  COLS,
  FIELD_H,
  FIELD_Y,
  ROWS,
  SPR,
  clamp,
  loadPlayerFrames,
  pick,
  rand,
  sec,
  MiniGame,
  type GameMeta,
  type GameOptions,
  type Slot,
} from './common';
import type { App } from '../scenes';

export const ARKANOID: GameMeta = {
  id: 'arkanoid',
  name: 'ARKANOID',
  desc: 'BOUNCE YOUR BUBBLE, SMASH THE WALLS',
  mode: 'solo',
  time: 60,
  music: 'ext1',
  countLabel: 'BRICKS',
  controls: 'LEFT/RIGHT MOVE THE PADDLE',
};

const PADDLE_W = 80;
const PADDLE_H = 32;
const PADDLE_Y = FIELD_H - PADDLE_H;
const ACCEL = 0.5;
const VMAX = 4.2;
const Y_MARGIN = 20;
const BASE_SPEED = 3.9;
const REBUILD = 80; // frames before a lost paddle comes back

interface Paddle {
  slot: Slot;
  x: number;
  y: number;
  vy: number;
  vx: number;
  landed: boolean;
  wait: number; // frames before serving
  alive: boolean;
  rebuild: number;
  look: number;
  ball: Ball | null;
}

interface Ball {
  owner: Paddle;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

interface Fruit {
  x: number;
  y: number;
  id: number;
}

export class Arkanoid extends MiniGame {
  private arena!: Arena;
  private frames!: Frame[][];
  private paddles: Paddle[] = [];
  private balls: Ball[] = [];
  private fruits: Fruit[] = [];
  private builder: Generator<void> | null = null;
  private total = 0;
  private killed = 0;
  private ready = false;

  constructor(app: App, opts: GameOptions) {
    super(app, ARKANOID, opts);
    this.readyFrames = sec(2.2);
  }

  protected async init(): Promise<void> {
    [this.arena, this.frames] = await Promise.all([Arena.load(this.app), loadPlayerFrames(this.app.gfx, 'ext1/image1_{p}.png', 80, 32)]);
    this.arena.bricks = (cx, cy) => cx >= 2 && cx < COLS - 2 && cy <= ROWS / 2;
    this.builder = this.build();
  }

  /** aget() of the original: outside x and above the board are walls, below is open. */
  private aget(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= COLS || cy < 0) return true;
    if (cy >= ROWS) return false;
    return this.arena.wall(cx, cy);
  }

  /** Clear the lower half row by row, then fill the top rows until ~1/5 of the board is bricks. */
  private *build(): Generator<void> {
    const a = this.arena;
    for (let y = ROWS - 1; y > Math.floor(ROWS / 2); y--) {
      yield;
      yield;
      for (let x = 2; x < COLS - 2; x++) a.set(x, y, false);
      this.sfx('pop', (y * 37) % 512);
    }
    const line = COLS - 4;
    const expected = Math.floor((line * ROWS) / 5);
    let y = Math.floor(ROWS / 2);
    let n = 0;
    while (y >= 0 && n + (y + 1) * line >= expected) {
      for (let x = 2; x < COLS - 2; x++) if (a.wall(x, y)) n++;
      y--;
    }
    while (y >= 0) {
      yield;
      yield;
      yield;
      for (let x = 2; x < COLS - 2; x++) a.set(x, y, true);
      this.sfx('ext1_brick', 256);
      y--;
    }
    this.total = 0;
    for (let yy = 0; yy <= Math.floor(ROWS / 2); yy++) for (let x = 2; x < COLS - 2; x++) if (a.wall(x, yy)) this.total++;
    this.ready = true;
    for (const s of this.slots) this.spawnPaddle(s, s.index === 0 ? 120 : 312);
  }

  private spawnPaddle(slot: Slot, x: number): void {
    const p: Paddle = { slot, x: clamp(x, 40, 512 - 40 - PADDLE_W), y: -40, vy: 0, vx: 0, landed: false, wait: 45, alive: true, rebuild: 0, look: 0, ball: null };
    const old = this.paddles.findIndex((q) => q.slot === slot);
    if (old >= 0) this.paddles.splice(old, 1, p);
    else this.paddles.push(p);
  }

  private get speed(): number {
    return BASE_SPEED + (this.total ? (this.killed / this.total) * 1.3 : 0);
  }

  protected step(): void {
    if (this.builder && this.builder.next().done) this.builder = null;
    for (const p of this.paddles) this.updatePaddle(p);
    for (const b of this.balls) this.updateBall(b);
    this.balls = this.balls.filter((b) => {
      if (b.y < FIELD_H) return true;
      this.lose(b.owner);
      return false;
    });
    for (const f of this.fruits) {
      f.y += 1.4;
      for (const p of this.paddles)
        if (p.alive && f.x + 28 > p.x && f.x + 4 < p.x + PADDLE_W && f.y + 28 > p.y && f.y < p.y + 20) {
          f.y = 9999;
          this.give(p.slot, 1000, f.x + 16, p.y - 8);
          this.sfx('fruit', f.x);
        }
    }
    this.fruits = this.fruits.filter((f) => f.y < FIELD_H);
    if (this.live && this.ready && this.killed >= this.total) {
      const secs = Math.ceil(this.timeLeft / 60);
      for (const s of this.slots) {
        s.score += secs * 100;
        this.fx.text(s.index === 0 ? 140 : 372, 300, `TIME BONUS ${secs * 100}`, '#ff5', 150);
      }
      this.app.audio.sfx('extralife');
      this.finish('ALL CLEAR!');
    }
  }

  private updatePaddle(p: Paddle): void {
    if (!p.alive) {
      if (--p.rebuild <= 0) this.spawnPaddle(p.slot, p.x + PADDLE_W / 2 - 40);
      return;
    }
    if (!p.landed) {
      // drop in with a little bounce
      if (p.y < PADDLE_Y) p.vy += 0.3;
      else if (p.vy > 0) {
        p.vy = -p.vy / 3;
        if (Math.abs(p.vy) < 0.6) {
          p.landed = true;
          p.y = PADDLE_Y;
        }
      }
      p.y = Math.min(p.y + p.vy, PADDLE_Y + 2);
      if (p.landed) p.y = PADDLE_Y;
    } else if (!p.ball && this.ready && this.phase === 'play') {
      if (--p.wait <= 0) this.serve(p);
    }
    let want = this.live ? this.pad(p.slot).dx : 0;
    if (p.x < 32) {
      if (p.vx < 0) p.vx = -p.vx * 0.45;
      want = 1;
    } else if (p.x + PADDLE_W > 512 - 32) {
      if (p.vx > 0) p.vx = -p.vx * 0.45;
      want = -1;
    }
    if (!want) {
      if (Math.abs(p.vx) <= ACCEL) p.vx = 0;
      else p.vx -= Math.sign(p.vx) * ACCEL * 0.8;
    } else p.vx = clamp(p.vx + ACCEL * want, -VMAX, VMAX);
    p.x += p.vx;
    p.look = want;
  }

  private serve(p: Paddle): void {
    const b: Ball = { owner: p, x: p.x + PADDLE_W / 2 - 16, y: p.y - Y_MARGIN, vx: 0, vy: 0, age: 0 };
    this.bounceAngle(b, (rand() - 0.5) * 0.6);
    p.ball = b;
    this.balls.push(b);
    this.sfx('ext1_wall', b.x);
  }

  private bounceAngle(b: Ball, angle: number): void {
    const s = this.speed;
    b.vx = Math.sin(angle) * s;
    b.vy = -Math.cos(angle) * s;
  }

  private updateBall(b: Ball): void {
    b.age++;
    // paddles: any paddle can return any ball
    if (b.y > FIELD_H / 2 + 1 && b.vy > 0) {
      for (const p of this.paddles) {
        if (!p.alive || !p.landed) continue;
        const dy = p.y - Y_MARGIN - b.y;
        if (dy < -12 || dy > 1) continue;
        const dx = b.x + 16 - (p.x + PADDLE_W / 2);
        let angle = dx / (PADDLE_W / 2 + 6);
        if (angle < -1 || angle > 1) continue;
        angle = angle >= 0 ? angle * 1.111 + 0.07 : angle * 1.111 - 0.07;
        this.bounceAngle(b, clamp(angle, -1.2, 1.2));
        this.sfx('ext1_wall', b.x);
        break;
      }
    }
    b.x += b.vx;
    b.y += b.vy;
    const cx = Math.floor(b.x / CELL) + 1;
    const cy = Math.floor(b.y / CELL) + 1;
    const dx = b.vx >= 0 ? 1 : -1;
    const dy = b.vy >= 0 ? 1 : -1;
    let hits = 0;
    let touched = false;
    if (this.aget(cx, cy)) {
      touched = true;
      hits += this.hit(cx, cy, 0, 0);
    }
    if (this.aget(cx + dx, cy)) {
      touched = true;
      hits += this.hit(cx + dx, cy, 0, dy);
      b.vx = -b.vx;
    }
    if (this.aget(cx, cy + dy)) {
      touched = true;
      hits += this.hit(cx, cy + dy, dx, 0);
      b.vy = -b.vy;
    }
    if (touched) {
      if (hits) {
        const slot = b.owner.slot;
        slot.count += hits;
        const pts = 125 * 2 ** hits;
        this.give(slot, pts, b.x + 16, b.y + 16);
        this.sfx('ext1_brick', b.x);
        if (rand() < 0.05) this.fruits.push({ x: b.x, y: b.y, id: pick(SPR.fruits) });
      } else this.sfx('ext1_wall', b.x);
    }
  }

  private hit(cx: number, cy: number, dx: number, dy: number): number {
    let n = 0;
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * dx;
      const y = cy + i * dy;
      if (x >= 2 && x < COLS - 2 && y >= 0 && y < ROWS && this.arena.wall(x, y)) {
        this.arena.set(x, y, false);
        this.fx.anim(x * CELL - 8, y * CELL - 8, SPR.pop, 2);
        this.killed++;
        n++;
      }
    }
    return n;
  }

  private lose(p: Paddle): void {
    p.ball = null;
    if (!p.alive) return;
    p.alive = false;
    p.rebuild = REBUILD;
    this.app.audio.sfx('pop', -0.8);
    this.app.audio.sfx('die', 0);
    this.fx.burst(p.x, p.y, PADDLE_W, PADDLE_H, 11);
  }

  protected render(g: Gfx): void {
    this.arena.draw(g);
    for (const f of this.fruits) g.draw(f.id, f.x, FIELD_Y + f.y);
    for (const p of this.paddles) {
      if (!p.alive) continue;
      g.drawFrame(this.frames[p.slot.index][0], p.x, FIELD_Y + p.y);
      const coming = this.balls.some((b) => b.vy > 0 && b.y > FIELD_H / 3);
      const eyes = `eyes:${p.look}:${coming ? -1 : 0}`;
      g.draw(g.has(eyes) ? eyes : 'eyes:0:0', p.x + PADDLE_W / 2 - 16, FIELD_Y + p.y);
    }
    for (const b of this.balls) {
      const id = b.age < 18 ? SPR.newBubble[Math.min(3, Math.floor(b.age / 6) + 1)] : SPR.bubble(this.t);
      g.draw(id, b.x, FIELD_Y + b.y, { p: b.owner.slot.index });
    }
    if (this.ready && this.live)
      for (const p of this.paddles)
        if (!p.alive && p.rebuild > 0 && (this.t >> 3) & 1)
          g.text('MISS!', p.x + PADDLE_W / 2, FIELD_Y + PADDLE_Y + 8, '#f66', { align: 'center' });
  }
}
