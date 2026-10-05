// ext2 - Pac-Man: the level is dug into a maze of 2-cell corridors (port of
// the original digger), dots line the walls, ghosts chase the bubble-pacs.
// 45 seconds; touching a ghost costs a few seconds before respawning.

import type { Frame, Gfx } from '../engine/gfx';
import {
  Arena,
  CELL,
  COLS,
  DirInput,
  FIELD_H,
  FIELD_W,
  FIELD_Y,
  ROWS,
  SPR,
  loadFrames,
  pick,
  rand,
  randInt,
  sec,
  shuffle,
  MiniGame,
  type GameMeta,
  type GameOptions,
  type Slot,
} from './common';
import type { App } from '../scenes';

export const PACMAN: GameMeta = {
  id: 'pacman',
  name: 'PAC-MAN',
  desc: 'EAT THE DOTS, DODGE THE GHOSTS',
  mode: 'solo',
  time: 45,
  music: 'ext2',
  countLabel: 'DOTS',
  controls: 'ARROWS STEER THE BUBBLE',
};

const WRAP_H = (ROWS + 2) * CELL;
const PAC_SPEED = 0.8; // 2-px steps per frame
const GHOST_SPEED = PAC_SPEED * (8 / 7);
const RESPAWN = sec(2.7);

interface Mover {
  x: number;
  y: number;
  dx: number;
  dy: number;
  wx: number; // wanted direction
  wy: number;
  turned: [number, number] | null;
  wasClear: boolean;
  lastMove: [number, number] | null;
  acc: number;
}

interface Pac extends Mover {
  slot: Slot;
  alive: boolean;
  timer: number; // respawn countdown / spawn shield
  started: boolean;
  input: DirInput;
}

interface Ghost extends Mover {
  wait: number;
  lastX: number;
  round: number;
  frame: number;
}

interface Dot {
  x: number;
  y: number;
  taken: boolean;
}

interface Fruit {
  x: number;
  y: number;
  id: number;
  points: number;
  life: number;
}

const FRUITS: [number, number][] = [
  [600, 750],
  [602, 800],
  [604, 850],
  [606, 900],
  [607, 950],
  [609, 1000],
];

export class Pacman extends MiniGame {
  private arena!: Arena;
  private mouth!: Frame[];
  private dotFrame!: Frame;
  private pacs: Pac[] = [];
  private ghosts: Ghost[] = [];
  private dots: Dot[] = [];
  private fruits: Fruit[] = [];
  private digger: Generator<void> | null = null;
  private fruitTimer = sec(4);

  constructor(app: App, opts: GameOptions) {
    super(app, PACMAN, opts);
    this.readyFrames = 99999;
  }

  protected async init(): Promise<void> {
    const [arena, mouth, misc] = await Promise.all([
      Arena.load(this.app),
      loadFrames(this.app.gfx, 'ext2/image1.png', 32, 32),
      this.app.gfx.sheet('ext2/image2.png'),
    ]);
    this.arena = arena;
    this.mouth = mouth;
    this.dotFrame = { img: misc, x: 0, y: 32, w: 8, h: 8 };
    this.digger = this.dig();
  }

  /** bget() of the original: outside x is wall, outside y reads row 0. */
  private bget(x: number, y: number): boolean {
    return this.arena.level.wall(x, y);
  }

  private anywall(x1: number, y1: number, x2: number, y2: number): boolean {
    for (let x = x1; x < x2; x++) for (let y = y1; y < y2; y++) if (this.bget(x, y)) return true;
    return false;
  }

  // --- maze digger (ext2 digwalls) ------------------------------------------------------

  private *dig(): Generator<void> {
    const a = this.arena;
    const W = COLS;
    const H = ROWS;
    const holes = new Map<number, number>();
    const K = (x: number, y: number) => y * 64 + x;
    const hget = (x: number, y: number) => holes.get(K(x, y));
    for (let x = 2; x < W - 2; x++) {
      if (a.wall(x, 0) || a.wall(x, H - 1)) {
        a.set(x, 0, true);
        a.set(x, H - 1, true);
      }
      for (let y = 1; y < H - 1; y++) if (!a.wall(x, y)) holes.set(K(x, y), 0);
      if (x % 7 === 0) yield;
    }
    let budget = 0;
    const self = this;
    function* rdig(x1: number, y1: number, x2: number, y2: number): Generator<void> {
      for (let y = y1; y < y2; y++)
        for (let x = x1; x < x2; x++) {
          if (a.wall(x, y)) {
            a.set(x, y, false);
            if (++budget % 6 === 0) yield;
          }
          if (!holes.has(K(x, y))) holes.set(K(x, y), 0);
        }
      const fill: [number, number][] = [];
      for (let x = x1; x < x2 - 1; x++) for (let y = y1; y < y2 - 1; y++) fill.push([x, y]);
      for (let i = 0; i < fill.length; i++) {
        const [x, y] = fill[i];
        const q = [hget(x, y), hget(x, y + 1), hget(x + 1, y), hget(x + 1, y + 1)];
        if (q.every((v) => v !== undefined) && q.some((v) => v === 0)) {
          holes.set(K(x, y), 1);
          holes.set(K(x, y + 1), 1);
          holes.set(K(x + 1, y), 1);
          holes.set(K(x + 1, y + 1), 1);
          fill.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
      }
    }
    const joined = (x1: number, y1: number, x2: number, y2: number): number => {
      if (x1 < 2 || y1 < 1 || x2 > W - 2 || y2 > H - 1) return -1;
      let a1 = 0;
      let a2 = 0;
      for (let x = x1; x < x2; x++) {
        a1 = hget(x, y1 - 1) ? a1 + 1 : 0;
        if (a1 === 2) return 1;
        a2 = hget(x, y2) ? a2 + 1 : 0;
        if (a2 === 2) return 1;
      }
      a1 = a2 = 0;
      for (let y = y1; y < y2; y++) {
        a1 = hget(x1 - 1, y) ? a1 + 1 : 0;
        if (a1 === 2) return 1;
        a2 = hget(x2, y) ? a2 + 1 : 0;
        if (a2 === 2) return 1;
      }
      return 0;
    };
    if (!holes.size) holes.set(K(W >> 1, H >> 1), 0);
    let list = shuffle([...holes.keys()].map((k) => [k % 64, Math.floor(k / 64)] as [number, number]));
    let [sx, sy] = list.pop()!;
    if (sx > W >> 1) sx--;
    if (sy > H >> 1) sy--;
    yield* rdig(sx, sy, sx + 2, sy + 2);
    const dlist: number[][] = [
      [0, 0, 1, 0, 0, -1],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, -1, 0],
      [0, 0, 0, 1, 0, 0],
      [-1, 0, 0, 0, -1, -1],
      [-1, 0, 0, 0, -1, 0],
      [0, -1, 0, 0, -1, -1],
      [0, -1, 0, 0, 0, -1],
    ];
    let guard = 0;
    while (list.length && guard++ < 400) {
      shuffle(dlist);
      const pending = list;
      list = [];
      let progress = false;
      for (const [x, y] of pending) {
        if (hget(x, y) !== 0) continue;
        let done = false;
        for (const [dx1, dy1, dx2, dy2, dx, dy] of dlist) {
          let x1 = x + dx;
          let y1 = y + dy;
          let x2 = x1 + 2;
          let y2 = y1 + 2;
          let r = 0;
          while (r === 0) {
            r = joined(x1, y1, x2, y2);
            if (r === 1) {
              yield* rdig(x1, y1, x2, y2);
              progress = true;
              break;
            }
            x1 += dx1;
            y1 += dy1;
            x2 += dx2;
            y2 += dy2;
          }
          if (r === 1) {
            done = true;
            break;
          }
        }
        if (!done) list.push([x, y]);
      }
      if (!progress) {
        const x = 2 + randInt(W - 4);
        const y = 1 + randInt(H - 2);
        list.unshift([x, y]);
        if (!holes.has(K(x, y))) holes.set(K(x, y), 0);
      }
      yield;
    }
    // remove diagonal wall pairs that make 1-cell pinches
    let progress = true;
    while (progress) {
      progress = false;
      for (let y = 1; y < H - 1; y++)
        for (let x = 3; x < W - 3; x++) {
          if (this.bget(x, y) || this.bget(x + 1, y) || this.bget(x - 1, y) || this.bget(x, y + 1) || this.bget(x, y - 1)) continue;
          if (this.bget(x - 1, y - 1) && this.bget(x + 1, y + 1)) {
            a.set(x - 1, y - 1, false);
            progress = true;
          } else if (this.bget(x + 1, y - 1) && this.bget(x - 1, y + 1)) {
            a.set(x + 1, y - 1, false);
            progress = true;
          }
        }
      yield;
    }
    self.placeDots();
  }

  private placeDots(): void {
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        if (!this.anywall(x, y, x + 2, y + 2) && this.anywall(x - 1, y - 1, x + 3, y + 3)) this.dots.push({ x: (x + 1) * CELL, y: (y + 1) * CELL, taken: false });
    // pacs and ghosts
    for (const s of this.slots) {
      const p = this.spot(s.index === 0 ? 2 : COLS - 4, ROWS - 3);
      this.pacs.push({ ...this.mover(p.x, p.y), slot: s, alive: true, timer: 0, started: false, input: new DirInput() });
    }
    const n = 2 + this.slots.length;
    for (let i = 0; i < n; i++) {
      const sp = this.spot(4 + randInt(COLS - 8), 1 + randInt(ROWS / 2));
      const g: Ghost = { ...this.mover(sp.x, sp.y), wait: sec(1.2) + i * 20, lastX: 0, round: 0, frame: randInt(4) };
      g.wx = rand() < 0.5 ? -1 : 1;
      this.ghosts.push(g);
    }
    this.readyFrames = this.phaseT + sec(1.2);
  }

  /** Free 2x2 spot (pixel top-left) nearest to cell (cx, cy). */
  private spot(cx: number, cy: number): { x: number; y: number } {
    let best = { x: cx * CELL, y: cy * CELL };
    let bd = Infinity;
    for (let y = 1; y < ROWS - 2; y++)
      for (let x = 2; x < COLS - 3; x++) {
        if (this.anywall(x, y, x + 2, y + 2)) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy) + rand() * 0.5;
        if (d < bd) {
          bd = d;
          best = { x: x * CELL, y: y * CELL };
        }
      }
    return best;
  }

  private mover(x: number, y: number): Mover {
    return { x, y, dx: 0, dy: 0, wx: 0, wy: 0, turned: null, wasClear: false, lastMove: null, acc: 0 };
  }

  /** One 2-px step of the original PacSprite.moving() loop. */
  private stepMover(m: Mover): void {
    if (m.wx !== m.dx || m.wy !== m.dy) {
      if ((m.wx && m.y % CELL === 0) || (m.wy && m.x % CELL === 0)) {
        m.turned = [m.dx, m.dy];
        m.dx = m.wx;
        m.dy = m.wy;
      }
    }
    for (let tries = 0; tries < 2; tries++) {
      let blocked: boolean;
      let clear = false;
      if (m.dx || m.dy) {
        const fx = m.x + CELL + m.dx * (CELL + 1);
        const fy = m.y + CELL + m.dy * (CELL + 1);
        clear = !this.bget(Math.floor((fx + m.dy) / CELL), Math.floor((fy - m.dx) / CELL)) && !this.bget(Math.floor((fx - m.dy) / CELL), Math.floor((fy + m.dx) / CELL));
        blocked = clear ? false : m.wasClear || (m.x <= 2 * CELL && m.dx < 0) || (m.x >= FIELD_W - 4 * CELL && m.dx > 0);
      } else blocked = true;
      if (blocked) {
        if (m.turned) {
          [m.dx, m.dy] = m.turned;
          m.turned = null;
          continue;
        }
        m.lastMove = null;
      } else {
        m.turned = null;
        m.lastMove = [m.dx, m.dy];
        m.x += 2 * m.dx;
        m.y += 2 * m.dy;
        if (m.y >= FIELD_H) m.y -= WRAP_H;
        else if (m.y < -32) m.y += WRAP_H;
        m.wasClear = clear;
      }
      return;
    }
  }

  protected step(): void {
    if (this.digger) {
      for (let i = 0; i < 3 && this.digger; i++) if (this.digger.next().done) this.digger = null;
      return;
    }
    for (const p of this.pacs) this.updatePac(p);
    if (this.live) for (const g of this.ghosts) this.updateGhost(g);
    // fruits
    if (this.live && --this.fruitTimer <= 0) {
      this.fruitTimer = sec(7);
      for (let j = 0; j < 100; j++) {
        const x = 4 + randInt(COLS - 10);
        const y = 3 + randInt(ROWS - 8);
        if (!this.anywall(x - 2, y - 2, x + 4, y + 4)) {
          const [id, points] = pick(FRUITS);
          this.fruits.push({ x: x * CELL, y: y * CELL, id, points, life: sec(8) });
          this.sfx('appear', x * CELL);
          break;
        }
      }
    }
    for (const f of this.fruits) f.life--;
    this.fruits = this.fruits.filter((f) => f.life > 0);
    if (this.live && this.dots.length && this.dots.every((d) => d.taken)) {
      const secs = Math.ceil(this.timeLeft / 60);
      for (const s of this.slots) {
        s.score += secs * 200;
        this.fx.text(s.index === 0 ? 140 : 372, 200, `TIME BONUS ${secs * 200}`, '#ff5', 150);
      }
      this.app.audio.sfx('extralife');
      this.finish('ALL DOTS EATEN!');
    }
  }

  private updatePac(p: Pac): void {
    if (p.timer > 0) p.timer--;
    if (!p.alive) {
      if (p.timer <= 0 && this.live) {
        p.alive = true;
        p.timer = sec(1.5);
        p.started = false;
        p.dx = p.dy = p.wx = p.wy = 0;
        this.sfx('appear', p.x);
      }
      return;
    }
    if (!this.live) return;
    const d = p.input.update(this.pad(p.slot));
    if (d) {
      [p.wx, p.wy] = d;
      p.started = true;
    }
    p.acc += PAC_SPEED;
    while (p.acc >= 1) {
      p.acc--;
      this.stepMover(p);
    }
    // dots and fruit under the centre
    const cx = p.x + CELL;
    const cy = p.y + CELL;
    for (const d of this.dots) {
      if (d.taken || Math.abs(d.x - cx) > 6 || Math.abs(d.y - cy) > 6) continue;
      d.taken = true;
      p.slot.count++;
      p.slot.score += 100;
      this.app.audio.sfx('extra', 0, { volume: 0.35 });
    }
    for (const f of this.fruits)
      if (f.life > 0 && Math.abs(f.x + 16 - cx) < 19 && Math.abs(f.y + 16 - cy) < 19) {
        f.life = 0;
        this.give(p.slot, f.points, f.x + 16, f.y + 16);
        this.sfx('fruit', f.x);
      }
    // ghosts
    if (p.timer <= 0)
      for (const g of this.ghosts)
        if (g.wait <= 0 && Math.abs(g.x - p.x) < 15 && Math.abs(g.y - p.y) < 15) {
          p.alive = false;
          p.timer = RESPAWN;
          this.sfx('pop', p.x);
          this.sfx('die', p.x);
          this.fx.burst(p.x + 4, p.y + 4, 24, 24, 9);
          break;
        }
  }

  private updateGhost(g: Ghost): void {
    g.frame++;
    if (g.wait > 0) {
      g.wait--;
      return;
    }
    g.acc += GHOST_SPEED;
    while (g.acc >= 1) {
      g.acc--;
      this.stepMover(g);
      if (rand() < 0.1) g.lastX = g.wx;
      const aligned = g.x % CELL === 0 && g.y % CELL === 0;
      if (!g.lastMove || (aligned && rand() < 0.06) || rand() < 0.01) {
        const live = this.pacs.filter((p) => p.alive);
        const targets = live.length ? live : this.pacs;
        let t = targets[0];
        let bd = Infinity;
        for (const p of targets) {
          const d = Math.abs(p.x - g.x) + Math.abs(p.y - g.y);
          if (d < bd) {
            bd = d;
            t = p;
          }
        }
        if (!t) return;
        if (g.lastX) {
          g.wx = 0;
          g.wy = t.y < g.y !== rand() < 0.3 ? -1 : 1;
        } else {
          g.wy = 0;
          g.wx = t.x < g.x !== rand() < 0.3 ? -1 : 1;
        }
      } else g.lastX = g.lastMove[0];
    }
  }

  protected render(g: Gfx): void {
    this.arena.draw(g);
    for (const d of this.dots) if (!d.taken) g.drawFrame(this.dotFrame, d.x - 4, FIELD_Y + d.y - 4);
    for (const f of this.fruits) if (f.life > sec(2) || (this.t >> 2) & 1) g.draw(f.id, f.x, FIELD_Y + f.y);
    for (const p of this.pacs) {
      if (!p.alive) continue;
      if (p.timer > 0 && (this.t >> 2) & 1) continue;
      for (const oy of p.y > FIELD_H - 32 ? [0, -WRAP_H] : [0]) {
        const y = FIELD_Y + p.y + oy;
        g.draw(189, p.x, y, { p: p.slot.index });
        if (!p.started || !(p.dx || p.dy)) {
          g.draw('eyes:0:0', p.x, y);
          continue;
        }
        const row = p.dx < 0 ? 0 : p.dy < 0 ? 1 : p.dx > 0 ? 2 : 3;
        const ph = p.lastMove ? Math.floor(this.t / 7) % 3 : 0;
        if (ph === 0) g.drawFrame(this.mouth[row * 2], p.x, y);
        else if (ph === 2) g.drawFrame(this.mouth[row * 2 + 1], p.x, y);
      }
    }
    for (const gh of this.ghosts) {
      const frames = gh.dx > 0 || (gh.dx === 0 && gh.wx > 0) ? SPR.ghost.right : SPR.ghost.left;
      const id = frames[Math.floor(gh.frame / 5) % 4];
      const alpha = gh.wait > 0 ? 0.4 + 0.3 * ((this.t >> 3) & 1) : 1;
      g.draw(id, gh.x, FIELD_Y + gh.y, { alpha });
    }
    for (const p of this.pacs)
      if (!p.alive && this.live) g.text(`${Math.ceil(p.timer / 60)}`, p.x + 16, FIELD_Y + p.y + 8, '#ff5', { align: 'center' });
  }
}
