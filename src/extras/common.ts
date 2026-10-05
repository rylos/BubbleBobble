// Shared helpers for the extra mini-games (The Bub's Brothers "extensions"):
// arena built from a level's walls, effects, HUD, the common scene skeleton
// (loading -> ready -> play -> end -> results) and best scores in localStorage.

import type { Frame, Gfx } from '../engine/gfx';
import { SCREEN_H, SCREEN_W } from '../engine/gfx';
import type { Pad } from '../engine/input';
import { Level, type LevelSet } from '../game/level';
import type { App, Scene } from '../scenes';

export const FPS = 60;
export const sec = (s: number) => Math.round(s * FPS);
export const CELL = 16;
export const COLS = 32;
export const ROWS = 25;
export const FIELD_Y = 32; // playfield origin on screen (HUD bar above)
export const FIELD_W = COLS * CELL; // 512
export const FIELD_H = ROWS * CELL; // 400
export const PCOLORS = ['#3e3', '#39f'];

export const rand = Math.random;
export const randInt = (n: number) => Math.floor(Math.random() * n);
export const pick = <T>(a: readonly T[]): T => a[randInt(a.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Gaussian sample (Box-Muller). */
export function gauss(mu: number, sigma: number): number {
  const u = 1 - rand();
  const v = rand();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- sprite ids from the main sheets --------------------------------------------

export const SPR = {
  bubble: (t: number) => 188 + [1, 2, 1, 0][Math.floor(t / 8) % 4], // player bubble ({p})
  newBubble: [191, 192, 193, 194], // forming bubble, small -> full ({p})
  pop: [131, 132, 133, 134, 135], // exploding bubble
  bigPop: [952, 953, 954, 955, 956, 913, 914, 915],
  dragonWalk: (left: boolean, f: number) => 210 + (left ? 0 : 3) + (f % 3), // {p}
  dragonShoot: (left: boolean) => 210 + (left ? 6 : 8),
  dragonFall: (left: boolean) => 683 + (left ? 0 : 1),
  dragonRise: (left: boolean) => 683 + (left ? 2 : 3),
  dragonBubbled: [693, 694, 695],
  flappy: { right: [317, 318, 319, 320], left: [321, 322, 323, 324], dead: [331, 332, 333, 334] },
  ghosty: { right: [291, 292, 293, 294], left: [295, 296, 297, 298], dead: [305, 306, 307, 308] },
  ghost: { left: [443, 444, 445, 446], right: [447, 448, 449, 450] },
  fireDrop: 489,
  explosion: [453, 454, 455], // Monky's decaying weapon: crash cloud
  fruits: [600, 602, 604, 606, 607, 609],
  star: (c: number, t: number) => 940 + (c % 6) * 2 + ((t >> 3) & 1),
};

const POINT_IDS: Record<number, number> = {
  100: 529, 150: 530, 200: 531, 250: 532, 300: 533, 350: 534, 500: 535, 550: 536, 600: 537, 650: 538,
  700: 539, 750: 540, 800: 541, 850: 542, 900: 543, 950: 544, 1000: 545, 2000: 546, 3000: 547,
  4000: 548, 5000: 549, 6000: 550, 7000: 551, 8000: 552, 9000: 553, 10000: 20, 20000: 21,
  30000: 22, 40000: 23, 50000: 24, 60000: 25, 70000: 26,
};

// --- best scores ------------------------------------------------------------------

const BEST_KEY = 'bbdx.extras.v1';

export function loadBest(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Store a score; returns true when it beats the previous best. */
export function submitBest(id: string, score: number): boolean {
  const all = loadBest();
  if (score <= (all[id] ?? 0)) return false;
  all[id] = score;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
  return true;
}

// --- sheets -------------------------------------------------------------------------

/** Slice an extra sheet (assets/sprites/<file>) into frames of w x h, left-to-right then top-to-bottom. */
export async function loadFrames(g: Gfx, file: string, w: number, h: number): Promise<Frame[]> {
  const img = await g.sheet(file);
  const out: Frame[] = [];
  for (let y = 0; y + h <= img.height; y += h) for (let x = 0; x + w <= img.width; x += w) out.push({ img, x, y, w, h });
  return out;
}

/** Same sheet for each player colour (file contains '{p}'). */
export async function loadPlayerFrames(g: Gfx, file: string, w: number, h: number): Promise<Frame[][]> {
  return Promise.all([0, 1].map((p) => loadFrames(g, file.replace('{p}', String(p)), w, h)));
}

// --- directional input: the most recently pressed held direction wins ------------------

export type Dir = [number, number];
const DIRS: [keyof Pad['held'], number, number][] = [
  ['left', -1, 0],
  ['right', 1, 0],
  ['up', 0, -1],
  ['down', 0, 1],
];

export class DirInput {
  private order: (keyof Pad['held'])[] = [];
  update(pad: Pad): Dir | null {
    for (const [b] of DIRS) {
      const i = this.order.indexOf(b);
      if (pad.held[b]) {
        if (pad.pressed(b) || i < 0) {
          if (i >= 0) this.order.splice(i, 1);
          this.order.push(b);
        }
      } else if (i >= 0) this.order.splice(i, 1);
    }
    const last = this.order[this.order.length - 1];
    const d = DIRS.find(([b]) => b === last);
    return d ? [d[1], d[2]] : null;
  }
}

// --- floating bubbles backdrop (menus) ------------------------------------------------

export class BubbleBackdrop {
  private bubbles = Array.from({ length: 18 }, () => this.make(true));
  private make(anywhere: boolean) {
    return {
      x: rand() * (SCREEN_W - 32),
      y: anywhere ? rand() * SCREEN_H : SCREEN_H + rand() * 60,
      v: 0.4 + rand() * 0.8,
      p: randInt(4),
      ph: rand() * 6,
    };
  }
  update(): void {
    for (const b of this.bubbles) {
      b.y -= b.v;
      b.ph += 0.03;
      if (b.y < -40) Object.assign(b, this.make(false));
    }
  }
  draw(g: Gfx, t: number): void {
    for (const b of this.bubbles) g.draw(SPR.bubble(t + b.ph * 10), b.x + Math.sin(b.ph) * 8, b.y, { p: b.p, alpha: 0.55 });
  }
}

/** Slowly scrolling starfield (space / sky backdrops). */
export class Starfield {
  private stars = Array.from({ length: 70 }, () => ({ x: rand() * FIELD_W, y: rand() * FIELD_H, v: 0.2 + rand() * 1.2, c: randInt(3) }));
  update(speed = 1): void {
    for (const s of this.stars) {
      s.y += s.v * speed;
      if (s.y > FIELD_H) {
        s.y -= FIELD_H;
        s.x = rand() * FIELD_W;
      }
    }
  }
  draw(g: Gfx, t: number): void {
    const cols = ['#668', '#aac', '#fff'];
    for (const s of this.stars) {
      const tw = (t + s.x) % 90 < 4 ? '#ff8' : cols[s.c];
      g.rect(s.x, FIELD_Y + s.y, s.v > 1 ? 2 : 1, s.v > 1 ? 2 : 1, tw);
    }
  }
}

// --- arena: a level's walls, editable, rendered like the main game ------------------------

function meanColor(img: HTMLImageElement): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  return [r / n, g / n, b / n];
}

export class Arena {
  readonly level: Level;
  private canvas = document.createElement('canvas');
  private drawn = -1;
  private mean: [number, number, number];
  /** Cells drawn as bricks (bevelled) instead of plain wall. */
  bricks: ((cx: number, cy: number) => boolean) | null = null;
  /** Use the side border pattern for columns 0-1 / 30-31. */
  useBorder = true;

  private constructor(
    set: LevelSet,
    readonly index: number,
    private tile: HTMLImageElement,
    private border: HTMLImageElement | null,
  ) {
    this.level = new Level(set.levels[index], index);
    this.canvas.width = FIELD_W;
    this.canvas.height = FIELD_H;
    this.mean = meanColor(tile);
  }

  /** Load a level (random one if index is omitted) with its wall pattern. */
  static async load(app: App, index?: number, setId = 'original'): Promise<Arena> {
    const set = await app.loadSet(setId);
    const i = index ?? randInt(Math.min(100, set.levels.length));
    const num = String(i + 1).padStart(3, '0');
    const dir = `levels/${set.id}/`;
    const tile = await app.gfx.loadImage(`${dir}${num}_tile.png`).catch(() => app.gfx.loadImage(`${dir}001_tile.png`));
    const border = await app.gfx.loadImage(`${dir}${num}_border.png`).catch(() => null);
    return new Arena(set, i, tile, border);
  }

  get color(): string {
    return this.level.def.color;
  }

  /** Wall test without the main game's wrap-around: outside x is wall, outside y is free. */
  wall(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= COLS) return true;
    if (cy < 0 || cy >= ROWS) return false;
    return this.level.walls[cy * COLS + cx] === 1;
  }

  set(cx: number, cy: number, v: boolean): void {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
    if ((this.level.walls[cy * COLS + cx] === 1) === v) return;
    this.level.setWall(cx, cy, v);
  }

  clear(x0 = 2, x1 = COLS - 2, y0 = 0, y1 = ROWS): void {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, false);
  }

  /** Force a redraw (e.g. when the brick predicate changes). */
  dirty(): void {
    this.drawn = -1;
  }

  private paint(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    const cells: [number, number][] = [];
    const border = this.useBorder ? this.border : null;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (border && (x < 2 || x >= COLS - 2)) continue;
        if (this.level.walls[y * COLS + x]) cells.push([x, y]);
      }
    // diagonal shadow (8 px), as the level renderer does
    ctx.fillStyle = `rgb(${this.mean.map((v) => Math.round(v * 0.45)).join(',')})`;
    for (let k = 1; k <= 8; k++) for (const [x, y] of cells) ctx.fillRect(x * CELL + k, y * CELL + k, CELL, CELL);
    if (border) for (let k = 1; k <= 8; k++) ctx.fillRect(32 + k - 1, 0, 1, FIELD_H);
    if (border) {
      const left = { sx: 0 };
      const right = { sx: border.width >= 64 ? 32 : 0 };
      for (let y0 = 0; y0 < FIELD_H; y0 += border.height) {
        ctx.drawImage(border, left.sx, 0, 32, border.height, 0, y0, 32, border.height);
        ctx.drawImage(border, right.sx, 0, 32, border.height, FIELD_W - 32, y0, 32, border.height);
      }
    }
    const tile = this.tile;
    const wnx = Math.max(1, Math.floor(tile.width / CELL));
    const wny = Math.max(1, Math.floor(tile.height / CELL));
    for (const [x, y] of cells) {
      ctx.drawImage(tile, (x % wnx) * CELL, (y % wny) * CELL, CELL, CELL, x * CELL, y * CELL, CELL, CELL);
      if (this.bricks?.(x, y)) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x * CELL, y * CELL, CELL, 1);
        ctx.fillRect(x * CELL, y * CELL, 1, CELL);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x * CELL, y * CELL + CELL - 1, CELL, 1);
        ctx.fillRect(x * CELL + CELL - 1, y * CELL, 1, CELL);
      }
    }
  }

  draw(g: Gfx, dy = 0): void {
    if (this.drawn !== this.level.version) {
      this.paint();
      this.drawn = this.level.version;
    }
    g.ctx.drawImage(this.canvas, 0, FIELD_Y + dy);
  }
}

// --- effects ---------------------------------------------------------------------------

interface Effect {
  x: number;
  y: number;
  vx: number;
  vy: number;
  frames: (number | string)[];
  rate: number;
  t: number;
  p: number;
  life: number;
  text?: string;
  color?: string;
}

export class Fx {
  list: Effect[] = [];
  /** Animated one-shot sprite at field coordinates (top-left). */
  anim(x: number, y: number, frames: (number | string)[], rate = 3, p = 0, vx = 0, vy = 0): void {
    this.list.push({ x, y, vx, vy, frames, rate, t: 0, p, life: frames.length * rate });
  }
  /** Several bubble pops scattered over a w x h box. */
  burst(x: number, y: number, w: number, h: number, n = 8, frames: (number | string)[] = SPR.pop): void {
    for (let i = 0; i < n; i++) this.anim(x + rand() * w - 16, y + rand() * h - 16, frames, 2 + randInt(3), 0, (rand() - 0.5) * 1.5, (rand() - 0.5) * 1.5);
  }
  /** Floating points value (centre at x,y). */
  points(x: number, y: number, value: number, p = 0): void {
    const id = POINT_IDS[value];
    if (id !== undefined) this.list.push({ x, y, vx: 0, vy: -0.6, frames: [id], rate: 70, t: 0, p, life: 70 });
    else this.list.push({ x, y, vx: 0, vy: -0.6, frames: [], rate: 70, t: 0, p, life: 70, text: String(value), color: PCOLORS[p] });
  }
  text(x: number, y: number, text: string, color = '#fff', life = 60): void {
    this.list.push({ x, y, vx: 0, vy: -0.5, frames: [], rate: life, t: 0, p: 0, life, text, color });
  }
  update(): void {
    for (const e of this.list) {
      e.t++;
      e.x += e.vx;
      e.y += e.vy;
    }
    this.list = this.list.filter((e) => e.t < e.life);
  }
  draw(g: Gfx): void {
    for (const e of this.list) {
      if (e.text) {
        g.text(e.text, e.x, FIELD_Y + e.y - 6, e.color, { align: 'center', scale: 1.5 });
        continue;
      }
      const id = e.frames[Math.min(e.frames.length - 1, Math.floor(e.t / e.rate))];
      if (e.frames.length === 1 && e.life === 70) {
        const f = g.frame(id, e.p);
        g.drawFrame(f, e.x - f.w / 2, FIELD_Y + e.y - f.h / 2, { alpha: e.t > 50 ? (70 - e.t) / 20 : 1 });
      } else g.draw(id, e.x, FIELD_Y + e.y, { p: e.p });
    }
  }
}

// --- game descriptors -------------------------------------------------------------------

export interface GameMeta {
  id: string;
  name: string;
  desc: string;
  /** 'solo' = 1-2 players together; 'versus' = 2 players or 1 vs CPU. */
  mode: 'solo' | 'versus';
  time: number | null; // seconds
  music: string;
  countLabel: string; // what the per-player counter counts (BRICKS, LINES...)
  controls: string;
}

export interface Slot {
  index: number; // player colour / pad
  cpu: boolean;
  score: number;
  count: number;
  out: boolean; // eliminated (game over for this player)
}

export interface GameOptions {
  players: number;
  exit: () => Scene;
  restart: () => Scene;
}

// --- the common mini-game scene ------------------------------------------------------------

export abstract class MiniGame implements Scene {
  phase: 'loading' | 'ready' | 'play' | 'end' = 'loading';
  /** Frames since the phase started. */
  phaseT = 0;
  /** Global frame counter (animation). */
  t = 0;
  timeLeft: number;
  slots: Slot[];
  fx = new Fx();
  endText = 'TIME UP!';
  private hurried = false;
  private error: string | null = null;
  private left = false;

  constructor(
    protected app: App,
    readonly meta: GameMeta,
    protected opts: GameOptions,
  ) {
    const versus = meta.mode === 'versus';
    const n = versus ? 2 : opts.players;
    this.slots = Array.from({ length: n }, (_, i) => ({ index: i, cpu: versus && i === 1 && opts.players < 2, score: 0, count: 0, out: false }));
    this.timeLeft = meta.time ? sec(meta.time) : 0;
    app.audio.stopMusic(0.2);
    queueMicrotask(() =>
      this.init()
        .then(() => {
          if (this.left) return;
          this.setPhase('ready');
          app.audio.playMusic(meta.music, true);
        })
        .catch((e) => {
          console.error(e);
          this.error = String(e);
        }),
    );
    if (import.meta.env.DEV) (window as unknown as { extra: unknown }).extra = this;
  }

  /** Load assets and build the board. */
  protected abstract init(): Promise<void>;
  /** One logic frame; called during 'ready' and 'play' (check `live` before reading input). */
  protected abstract step(): void;
  /** Draw the playfield (HUD and overlays are drawn by the base class). */
  protected abstract render(g: Gfx): void;

  /** Frames the READY banner stays up. */
  protected readyFrames = sec(1.6);

  get live(): boolean {
    return this.phase === 'play';
  }

  pad(slot: Slot): Pad {
    return this.app.input.pads[slot.index];
  }

  sfx(name: string, x = FIELD_W / 2): void {
    this.app.audio.sfx(name, (x - FIELD_W / 2) / (FIELD_W / 2));
  }

  give(slot: Slot, points: number, x?: number, y?: number): void {
    slot.score += points;
    if (x !== undefined && y !== undefined) this.fx.points(x, y, points, slot.index);
  }

  protected setPhase(p: MiniGame['phase']): void {
    this.phase = p;
    this.phaseT = 0;
  }

  /** End the game now (banner, then the results screen). */
  finish(text = this.endText): void {
    if (this.phase === 'end') return;
    this.endText = text;
    this.setPhase('end');
    this.app.audio.stopMusic(1.2);
  }

  update(): void {
    const m = this.app.input.menu;
    if (m.pressed('pause')) {
      this.left = true;
      this.app.audio.stopMusic(0.2);
      this.app.audio.sfx('pop');
      this.app.go(this.opts.exit());
      return;
    }
    this.t++;
    this.phaseT++;
    if (this.phase === 'loading') return;
    if (this.phase === 'ready' && this.phaseT >= this.readyFrames) this.setPhase('play');
    if (this.phase === 'ready' || this.phase === 'play') this.step();
    if (this.phase === 'play' && this.meta.time) {
      this.timeLeft--;
      if (this.timeLeft === sec(10) && !this.hurried) {
        this.hurried = true;
        this.app.audio.sfx('hurry');
        this.app.audio.setMusicRate(1.12);
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish('TIME UP!');
      }
    }
    this.fx.update();
    if (this.phase === 'end' && this.phaseT > sec(2.5)) {
      this.app.audio.setMusicRate(1);
      this.app.go(new ResultsScene(this.app, this.meta, this.slots, this.opts, this.endText));
    }
  }

  /** Bottom strip text per slot (override for custom counters). */
  protected countText(s: Slot): string {
    return `${this.meta.countLabel} ${s.count}`;
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    if (this.phase === 'loading') {
      g.text(this.error ? 'LOAD ERROR' : 'LOADING...', SCREEN_W / 2, SCREEN_H / 2, this.error ? '#f44' : '#fff', { align: 'center' });
      return;
    }
    this.render(g);
    this.fx.draw(g);
    this.drawHud(g);
    if (this.phase === 'ready') {
      const go = this.phaseT > this.readyFrames - sec(0.5);
      g.rect(0, FIELD_Y + FIELD_H / 2 - 30, SCREEN_W, 56, '#000', 0.5);
      g.text(go ? 'GO!' : 'READY', SCREEN_W / 2, FIELD_Y + FIELD_H / 2 - 18, go ? '#ff5' : '#fff', { align: 'center', scale: 4 });
    } else if (this.phase === 'end') {
      g.rect(0, FIELD_Y + FIELD_H / 2 - 30, SCREEN_W, 56, '#000', 0.6);
      const c = (this.t >> 3) & 1 ? '#ff5' : '#f84';
      g.text(this.endText, SCREEN_W / 2, FIELD_Y + FIELD_H / 2 - 16, c, { align: 'center', scale: 3 });
    }
  }

  protected drawHud(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, FIELD_Y, '#000');
    g.rect(0, SCREEN_H - 16, SCREEN_W, 16, '#000');
    // centre: title and timer
    g.text(this.meta.name, SCREEN_W / 2, 2, '#f33', { align: 'center' });
    if (this.meta.time) {
      const s = Math.ceil(this.timeLeft / FPS);
      const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      const warn = s <= 10 && this.phase === 'play';
      g.text(txt, SCREEN_W / 2, 17, warn && (this.t >> 3) & 1 ? '#f44' : '#fff', { align: 'center' });
    } else {
      g.text(`BEST ${loadBest()[this.meta.id] ?? 0}`, SCREEN_W / 2, 18, '#888', { align: 'center', scale: 1.5 });
    }
    for (const s of this.slots) {
      const left = s.index === 0;
      const x = left ? 12 : SCREEN_W - 12;
      const align = left ? 'left' : 'right';
      const label = s.cpu ? 'CPU' : `${s.index + 1}UP`;
      g.text(label, x, 2, PCOLORS[s.index], { align });
      g.text(String(s.score).padStart(7, ' '), left ? x + 112 : x, 17, s.out ? '#777' : '#fff', { align: 'right' });
      g.text(this.countText(s), x, SCREEN_H - 13, PCOLORS[s.index], { align, scale: 1.5 });
    }
  }
}

// --- results ---------------------------------------------------------------------------

export class ResultsScene implements Scene {
  private t = 0;
  private backdrop = new BubbleBackdrop();
  private records: boolean[];
  private best: number;
  private sel = 0;

  constructor(
    private app: App,
    private meta: GameMeta,
    private slots: Slot[],
    private opts: GameOptions,
    private reason: string,
  ) {
    const prev = loadBest()[meta.id] ?? 0;
    this.records = slots.map((s) => !s.cpu && s.score > prev && s.score > 0);
    for (const s of slots) if (!s.cpu) submitBest(meta.id, s.score);
    this.best = loadBest()[meta.id] ?? 0;
    app.audio.playMusic('potion', false);
    if (this.records.some(Boolean)) app.audio.sfx('extralife');
  }

  update(): void {
    this.t++;
    this.backdrop.update();
    const m = this.app.input.menu;
    if (this.t < 40) return;
    if (m.pressed('up') || m.pressed('down') || m.pressed('left') || m.pressed('right')) {
      this.sel ^= 1;
      this.app.audio.sfx('pop');
    }
    if (m.pressed('pause')) {
      this.app.audio.sfx('pop');
      this.app.go(this.opts.exit());
    } else if (m.pressed('confirm')) {
      this.app.audio.sfx('pop');
      this.app.go(this.sel === 0 ? this.opts.restart() : this.opts.exit());
    }
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    g.text(this.meta.name, SCREEN_W / 2, 28, '#ff5', { align: 'center', scale: 3 });
    g.text(this.reason, SCREEN_W / 2, 66, '#f84', { align: 'center' });
    const versus = this.meta.mode === 'versus' || this.slots.length > 1;
    let winner = -1;
    if (versus && this.slots.length > 1) {
      const [a, b] = this.slots;
      const ka = this.meta.mode === 'versus' ? a.count : a.score;
      const kb = this.meta.mode === 'versus' ? b.count : b.score;
      winner = ka === kb ? -1 : ka > kb ? 0 : 1;
    }
    const n = this.slots.length;
    this.slots.forEach((s, i) => {
      const cx = n === 1 ? SCREEN_W / 2 : i === 0 ? SCREEN_W / 4 : (SCREEN_W * 3) / 4;
      const y = 110;
      const bob = Math.sin(this.t / 12 + i) * 3;
      const won = winner === i;
      const pose = won || n === 1 ? 213 + (Math.floor(this.t / 8) % 3) : 210 + 10 + (Math.floor(this.t / 10) % 3);
      g.draw(pose, cx - 32, y + bob, { p: s.index, scale: 2 });
      g.text(s.cpu ? 'CPU' : `PLAYER ${s.index + 1}`, cx, y + 76, PCOLORS[s.index], { align: 'center' });
      g.text(`${this.meta.countLabel} ${s.count}`, cx, y + 102, '#fff', { align: 'center' });
      g.text(`SCORE ${s.score}`, cx, y + 124, '#fff', { align: 'center' });
      if (this.records[i] && (this.t >> 3) & 1) g.text('NEW RECORD!', cx, y + 148, '#ff5', { align: 'center' });
      if (won) g.text('WINNER!', cx, y - 22, (this.t >> 2) & 1 ? '#ff5' : '#fa3', { align: 'center' });
    });
    if (winner < 0 && n > 1) g.text('DRAW GAME', SCREEN_W / 2, 296, '#ccc', { align: 'center' });
    g.text(`BEST SCORE ${this.best}`, SCREEN_W / 2, 322, '#8af', { align: 'center' });
    const items = ['PLAY AGAIN', 'EXTRA GAMES'];
    items.forEach((it, i) => {
      const on = i === this.sel;
      const x = SCREEN_W / 2 + (i === 0 ? -110 : 110);
      g.text(it, x, 370, on ? '#ff5' : '#999', { align: 'center' });
      if (on) g.draw(190, x - g.textWidth(it) / 2 - 36, 362, { p: 0, alpha: 0.9 });
    });
    g.text('ENTER CONFIRM   ESC MENU', SCREEN_W / 2, SCREEN_H - 24, '#666', { align: 'center', scale: 1.5 });
  }
}
