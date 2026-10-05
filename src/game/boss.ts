// Final round: Super Drunk, a giant bottle-throwing Drunk that only lightning can hurt.
// Builds its own arena (the set's last board is usually a message, not a battlefield).

import type { Gfx } from '../engine/gfx';
import { CELL, sec } from './const';
import { Entity, rand } from './entity';
import { Level, type LevelDef } from './level';
import { Bubble, type PopList } from './bubble';
import { Dragon, type Player } from './dragon';
import { FallingTreasure, pickDiamond } from './items';
import { Burst, LightningBolt, Star } from './specials';
import type { World } from './world';

export interface BossHandle {
  defeated: boolean;
  update(world: World): void;
  draw(g: Gfx, world: World): void;
}

const W = 32;
const H = 25;
const SCALE = 3;
const SIZE = 32 * SCALE;
const HOLE = [15, 16]; // floor and ceiling hole columns, also the bubble lanes

const WALK_R = 399;
const WALK_L = 403;
const ANGRY_R = 852;
const ANGRY_L = 856;
const JAILED = [407, 408, 409];
const BOTTLE = 472;
const BIG_BUBBLE = [910, 911, 912];
const POPS = [913, 914, 915];

const BOSS = {
  hp: 40, // + hpPerPlayer for each extra player
  hpPerPlayer: 16,
  speed: 1.1,
  angrySpeed: 1.7,
  throwEvery: [sec(3.4), sec(1.6)], // base + random
  angryThrowEvery: [sec(2.1), sec(1)],
  windup: 36,
  angryWindup: 24,
  bottles: 3,
  angryBottles: 5,
  bottleSpeed: 2.8,
  angryBottleSpeed: 3.5,
  maxLightning: 6,
  lightningEvery: sec(1.1),
  hitPoints: 200,
  defeatBonus: 50000,
  megaDiamond: 50000,
  diamonds: 10,
  diamondValue: 5000,
};

// --- arena -------------------------------------------------------------------

function arenaDef(base: LevelDef): LevelDef {
  const walls = Array.from({ length: H }, () => Array<string>(W).fill(' '));
  const wall = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) walls[y][x] = '#';
  };
  for (let y = 0; y < H; y++) {
    wall(0, 1, y);
    wall(W - 2, W - 1, y);
  }
  for (const y of [0, H - 1]) {
    wall(0, W - 1, y);
    for (const x of HOLE) walls[y][x] = ' ';
  }
  for (const y of [5, 15]) {
    wall(2, 7, y);
    wall(13, 18, y);
    wall(24, 29, y);
  }
  for (const y of [10, 20]) {
    wall(6, 12, y);
    wall(19, 25, y);
  }

  // winds: bubbles rise in the middle lanes, then snake down each half and come back
  const winds = Array.from({ length: H }, () => Array<string>(W).fill(' '));
  const left: [number, number, string][] = [];
  const put = (x: number, y: number, c: string) => left.push([x, y, c]);
  for (let y = 0; y < H; y++) {
    put(15, y, '^');
    put(2, y, '>');
  }
  const hrow = (y: number, x0: number, x1: number, c: string) => {
    for (let x = x0; x <= x1; x++) put(x, y, c);
  };
  const vcol = (x: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) put(x, y, 'v');
  };
  hrow(2, 4, 15, '<');
  vcol(3, 2, 5);
  hrow(6, 3, 11, '>');
  vcol(12, 6, 9);
  hrow(10, 4, 12, '<');
  vcol(3, 10, 13);
  hrow(14, 3, 11, '>');
  vcol(12, 14, 17);
  hrow(18, 4, 12, '<');
  vcol(3, 18, 20);
  hrow(21, 3, 14, '>');
  const mirror: Record<string, string> = { '<': '>', '>': '<' };
  for (const [x, y, c] of left) {
    winds[y][x] = c;
    winds[y][W - 1 - x] = mirror[c] ?? c;
  }

  return {
    walls: walls.map((r) => r.join('')),
    winds: winds.map((r) => r.join('')),
    monsters: [],
    flags: { letter: false, fire: false, lightning: false, water: false, top: false },
    holes: true,
    color: base.color,
    tile: base.tile,
    border: null,
  };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16) || 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function meanColor(img: HTMLImageElement): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const s = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k];
  const n = d.length / 4;
  return [s[0] / n, s[1] / n, s[2] / n];
}

/** Walls + 8 px diagonal drop shadow, like the prebuilt level images. */
function paintArena(canvas: HTMLCanvasElement, lv: Level, tile: HTMLImageElement | null): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const mean = tile ? meanColor(tile) : hexRgb(lv.def.color);
  const cells: [number, number][] = [];
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (lv.walls[y * lv.w + x]) cells.push([x, y]);
  ctx.fillStyle = `rgb(${mean.map((v) => Math.round(v * 0.45)).join(',')})`;
  for (let k = 1; k <= 8; k++) for (const [x, y] of cells) ctx.fillRect(x * CELL + k, y * CELL + k, CELL, CELL);
  const wnx = tile ? Math.max(1, Math.floor(tile.width / CELL)) : 1;
  const wny = tile ? Math.max(1, Math.floor(tile.height / CELL)) : 1;
  ctx.fillStyle = lv.def.color;
  for (const [x, y] of cells) {
    if (tile) ctx.drawImage(tile, (x % wnx) * CELL, (y % wny) * CELL, CELL, CELL, x * CELL, y * CELL, CELL, CELL);
    else ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
}

// --- reward ------------------------------------------------------------------

/** The 90x90 mega diamond: 32x32 feet like any item, but drawn (and touchable) big. */
class MegaDiamond extends FallingTreasure {
  update(world: World): void {
    super.update(world);
    if (this.dead) return;
    const box = { x: this.x - 29, y: this.y - 58, w: 90, h: 90 };
    const d = world.dragons.find((q) => q.alive && q.overlaps(box, 8));
    if (d) this.pickUp(world, d);
  }
  draw(g: Gfx, world: World): void {
    if (this.age > this.lifetime - sec(2) && world.frame & 4) return;
    g.draw(this.spriteId, this.x + 16 - 45, this.y + 32 - 90 + Math.sin(this.age / 10) * 2);
  }
}

// --- the boss ------------------------------------------------------------------

interface Bottle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

type Phase = 'intro' | 'move' | 'windup' | 'trapped' | 'popping' | 'gone';

const tints = new Map<string, HTMLCanvasElement>();
function tinted(g: Gfx, id: number, color: string): HTMLCanvasElement {
  const key = `${id}|${color}`;
  let c = tints.get(key);
  if (!c) {
    const f = g.frame(id);
    c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const x = c.getContext('2d')!;
    x.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    x.globalCompositeOperation = 'source-atop';
    x.globalAlpha = 0.8;
    x.fillStyle = color;
    x.fillRect(0, 0, f.w, f.h);
    tints.set(key, c);
  }
  return c;
}

class SuperDrunk implements BossHandle {
  defeated = false;
  x: number;
  y = -SIZE - 8;
  private vx = BOSS.speed;
  private vy = BOSS.speed * 0.75;
  private dir: 1 | -1 = 1;
  private phase: Phase = 'intro';
  private t = 0; // frames in phase
  private age = 0;
  readonly maxHp: number;
  hp: number;
  private angry = false;
  private flash = 0;
  private throwTimer = sec(2);
  private bottles: Bottle[] = [];
  private lightningTimer = 0;
  private lane = 0;
  private musicTimer = sec(7.2);
  private lastHitter: Player | null = null;
  private shownHp = 0;

  constructor(world: World) {
    this.x = world.level.pw / 2 - SIZE / 2;
    this.maxHp = BOSS.hp + BOSS.hpPerPlayer * Math.max(0, world.activePlayers.length - 1);
    this.hp = this.maxHp;
  }

  private get cx(): number {
    return this.x + SIZE / 2;
  }
  private get cy(): number {
    return this.y + SIZE / 2;
  }
  /** Body box (the sprite has some empty margin). */
  private box(inset: number) {
    return { x: this.x + inset, y: this.y + inset, w: SIZE - 2 * inset, h: SIZE - inset };
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.t = 0;
  }

  update(world: World): void {
    this.age++;
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.musicTimer > 0 && --this.musicTimer === 0 && world.activePlayers.length) world.audio.playMusic('potion');
    const lv = world.level;

    if (this.phase !== 'trapped' && this.phase !== 'popping' && this.phase !== 'gone') this.spawnLightning(world);

    switch (this.phase) {
      case 'intro':
        this.y = Math.min(48, this.y + 1.4);
        if (this.t > sec(2.6)) this.setPhase('move');
        break;
      case 'move': {
        const s = (this.angry ? BOSS.angrySpeed : BOSS.speed) / BOSS.speed;
        this.x += this.vx * s;
        this.y += this.vy * s;
        const [x0, x1, y0, y1] = [2 * CELL, lv.pw - 2 * CELL - SIZE, CELL, lv.ph - CELL - SIZE];
        // bounce off the outer walls, with a little random angle so the path never repeats
        if (this.x < x0 || this.x > x1) {
          this.x = Math.max(x0, Math.min(x1, this.x));
          this.vx = -Math.sign(this.vx) * BOSS.speed * (0.85 + rand() * 0.35);
        }
        if (this.y < y0 || this.y > y1) {
          this.y = Math.max(y0, Math.min(y1, this.y));
          this.vy = -Math.sign(this.vy) * BOSS.speed * (0.6 + rand() * 0.35);
        }
        this.dir = this.vx > 0 ? 1 : -1;
        if (--this.throwTimer <= 0) {
          this.setPhase('windup');
          world.sfx('spin', { x: this.cx });
        }
        break;
      }
      case 'windup':
        if (this.t >= (this.angry ? BOSS.angryWindup : BOSS.windup)) {
          this.throwFan(world);
          const [base, r] = this.angry ? BOSS.angryThrowEvery : BOSS.throwEvery;
          this.throwTimer = base + Math.floor(rand() * r);
          this.setPhase('move');
        }
        break;
      case 'trapped':
        this.y = Math.max(24, this.y - 0.7);
        this.x += Math.sin(this.t / 14) * 0.6;
        if (this.t > sec(2.6) && this.y <= 24) {
          this.setPhase('popping');
          world.shake = 40;
          world.sfx('shh');
        }
        break;
      case 'popping':
        if (this.t % 4 === 0) {
          const frames = this.t % 8 ? POPS : [952, 953, 954, 955, 956, ...POPS];
          world.add(new Burst(this.cx - 32 + (rand() - 0.5) * 120, this.cy - 32 + (rand() - 0.5) * 120, frames, 3));
          world.sfx('pop', { x: this.cx });
        }
        if (this.t >= sec(1.4)) this.explode(world);
        break;
      case 'gone':
        if (this.t >= sec(1.2)) this.defeated = true;
        break;
    }

    this.updateBottles(world);
    if (this.phase === 'move' || this.phase === 'windup') {
      this.checkBolts(world);
      const body = this.box(14);
      for (const d of world.dragons) if (d.vulnerable && d.overlaps(body, 4)) d.die(world);
    }
  }

  private spawnLightning(world: World): void {
    if (--this.lightningTimer > 0) return;
    this.lightningTimer = BOSS.lightningEvery;
    const n = world.bubbles.filter((b) => b.kind === 'lightning' && b.touchable).length;
    if (n >= BOSS.maxLightning) return;
    // left lane snakes through the left half, right lane through the right half
    const x = HOLE[this.lane] * CELL - 8;
    this.lane ^= 1;
    const b = Bubble.floating('lightning', x, world.level.ph, 0, -1, world.randomPlayerColor());
    world.add(b);
  }

  private throwFan(world: World): void {
    const n = this.angry ? BOSS.angryBottles : BOSS.bottles;
    const speed = this.angry ? BOSS.angryBottleSpeed : BOSS.bottleSpeed;
    const targets = world.dragons.filter((d) => d.alive);
    let aim = Math.PI / 2;
    if (targets.length) {
      const t = targets.reduce((a, b) => (Math.hypot(a.cx - this.cx, a.cy - this.cy) < Math.hypot(b.cx - this.cx, b.cy - this.cy) ? a : b));
      aim = Math.atan2(t.cy - this.cy, t.cx - this.cx);
      this.dir = t.cx > this.cx ? 1 : -1;
    }
    const step = this.angry ? 0.28 : 0.34;
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * step;
      this.bottles.push({ x: this.cx - 16, y: this.cy - 16, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0 });
    }
    world.sfx('ext3_shoot', { x: this.cx });
  }

  private updateBottles(world: World): void {
    const lv = world.level;
    for (const b of this.bottles) {
      b.age++;
      b.x += b.vx;
      b.y += b.vy;
      const box = { x: b.x + 7, y: b.y + 7, w: 18, h: 18 };
      for (const d of world.dragons) if (d.vulnerable && d.overlaps(box, 5)) d.die(world);
    }
    this.bottles = this.bottles.filter((b) => b.x > -40 && b.x < lv.pw + 8 && b.y > -40 && b.y < lv.ph + 8);
  }

  private checkBolts(world: World): void {
    const body = this.box(6);
    for (const f of world.fx) {
      if (!(f instanceof LightningBolt) || f.dead || !f.overlaps(body)) continue;
      f.kill();
      this.hit(world, f.popList, f);
      if (this.hp <= 0) return;
    }
  }

  private hit(world: World, list: PopList, at: Entity): void {
    const p = list.dragon?.player ?? this.lastHitter;
    if (p) this.lastHitter = p;
    this.hp--;
    this.flash = 12;
    world.shake = Math.max(world.shake, 8);
    world.sfx('ext7_hit', { x: this.cx });
    world.add(new Burst(at.x - 20, at.y - 20, POPS, 3));
    if (p) world.givePoints(p, BOSS.hitPoints, at.x, at.y);
    if (!this.angry && this.hp <= this.maxHp / 2) {
      this.angry = true;
      world.sfx('hell');
      world.flashText('SUPER DRUNK IS MAD!', 3);
      world.audio.setMusicRate(1.12);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.bottles = [];
      this.setPhase('trapped');
      world.shake = 20;
      world.sfx('capture', { x: this.cx });
      world.audio.stopMusic(1);
      this.musicTimer = 0;
    }
  }

  private explode(world: World): void {
    this.setPhase('gone');
    world.shake = 30;
    world.sfx('chain');
    world.sfx('fanfare');
    const list: PopList = { dragon: this.lastHitter?.dragon ?? null, kills: 0 };
    for (let i = 0; i < 14; i++) world.add(new Star(this.cx - 16, this.cy - 16, (i / 14) * Math.PI * 2, list));
    for (let i = 0; i < 6; i++) world.add(new Burst(this.cx - 32 + (rand() - 0.5) * 120, this.cy - 32 + (rand() - 0.5) * 120, [952, 953, 954, 955, 956, 913, 914, 915], 3));
    if (this.lastHitter) world.givePoints(this.lastHitter, BOSS.defeatBonus, this.cx - 16, this.cy - 16);
    world.flashText('SUPER DRUNK DEFEATED!', this.lastHitter?.index ?? 0, sec(4));
    // rewards: the mega diamond lands on the middle platforms, small ones everywhere
    const mega = new MegaDiamond(world.level.pw / 2 - 16, this.cy - 16, 16 + Math.floor(rand() * 4), BOSS.megaDiamond);
    mega.lifetime = sec(12);
    world.add(mega);
    for (let i = 0; i < BOSS.diamonds; i++) {
      const x = 3 * CELL + Math.floor(rand() * (world.level.w - 8)) * CELL;
      world.add(new FallingTreasure(x, -32 - i * 22, pickDiamond(), BOSS.diamondValue));
    }
  }

  // --- drawing -------------------------------------------------------------------

  draw(g: Gfx, world: World): void {
    for (const b of this.bottles) g.draw(BOTTLE, b.x, b.y, { rot: b.age * 0.3 * Math.sign(b.vx || 1) });
    const lv = world.level;
    switch (this.phase) {
      case 'gone':
        break;
      case 'trapped':
      case 'popping': {
        if (this.phase === 'popping' && this.t & 2) break;
        const id = JAILED[Math.floor(this.age / 8) % 3];
        g.draw(id, this.x, this.y, { scale: SCALE });
        const bs = 2.4;
        g.draw(BIG_BUBBLE[Math.floor(this.age / 10) % 3], this.cx - 32 * bs, this.cy - 32 * bs, { scale: bs, alpha: 0.9 });
        break;
      }
      default: {
        const winding = this.phase === 'windup';
        const angryLook = this.angry || winding;
        const base = angryLook ? (this.dir > 0 ? ANGRY_R : ANGRY_L) : this.dir > 0 ? WALK_R : WALK_L;
        const id = base + (Math.floor(this.age / (winding ? 3 : this.angry ? 5 : 8)) % 4);
        const jx = winding ? Math.round((rand() - 0.5) * 4) : 0;
        const bob = Math.round(Math.sin(this.age / 9) * 2);
        if (this.flash > 0) {
          const c = tinted(g, id, (this.flash >> 1) & 1 ? '#fff' : '#f33');
          g.ctx.drawImage(c, Math.round(this.x + jx), Math.round(this.y + bob), SIZE, SIZE);
        } else g.draw(id, this.x + jx, this.y + bob, { scale: SCALE });
      }
    }
    if (this.phase === 'intro') {
      g.text('SUPER DRUNK', lv.pw / 2, lv.ph / 2 + 20, (this.age >> 3) & 1 ? '#f44' : '#ff5', { align: 'center', scale: 3 });
      g.text(`ROUND ${world.levelIndex + 1}`, lv.pw / 2, lv.ph / 2 - 6, '#fff', { align: 'center' });
    }
    this.drawHp(g, world);
  }

  private drawHp(g: Gfx, world: World): void {
    if (this.phase === 'gone') return;
    // fills up during the intro, then eases towards the real value
    const target = this.phase === 'intro' ? Math.min(1, this.t / sec(2)) * this.hp : this.hp;
    this.shownHp += (target - this.shownHp) * 0.15;
    const x = 64;
    const w = world.level.pw - 2 * x;
    const frac = Math.max(0, this.shownHp / this.maxHp);
    g.rect(x - 2, 2, w + 4, 12, '#fff');
    g.rect(x, 4, w, 8, '#300');
    const col = this.angry ? ((world.frame >> 3) & 1 ? '#f22' : '#f80') : '#fc2';
    g.rect(x, 4, Math.round(w * frac), 8, col);
    g.rect(x, 4, Math.round(w * frac), 2, '#fff', 0.35);
  }
}

// --- setup -------------------------------------------------------------------------

const arenas = new WeakSet<Level>();

/** Build the boss arena and its wall image ahead of time (used for the scroll into round 100). */
export async function buildBossArena(world: World, index: number): Promise<{ level: Level; image: HTMLImageElement }> {
  const lv = new Level(arenaDef(world.set.levels[index]), index);
  arenas.add(lv);
  const canvas = document.createElement('canvas');
  canvas.width = lv.pw;
  canvas.height = lv.ph;
  const dir = `levels/${world.set.id}/`;
  const num = String(index + 1).padStart(3, '0');
  const tile = await world.gfx
    .loadImage(`${dir}${num}_tile.png`)
    .catch(() => world.gfx.loadImage(`${dir}001_tile.png`))
    .catch(() => null);
  paintArena(canvas, lv, tile);
  return { level: lv, image: canvas as unknown as HTMLImageElement };
}

export function setupBossRound(world: World): void {
  let lv = world.level;
  if (!arenas.has(lv)) {
    lv = new Level(arenaDef(world.level.def), world.levelIndex);
    world.level = lv;
    const canvas = document.createElement('canvas');
    canvas.width = lv.pw;
    canvas.height = lv.ph;
    paintArena(canvas, lv, null);
    world.levelImage = canvas as unknown as HTMLImageElement;
    const arena = lv;
    void buildBossArena(world, world.levelIndex).then(({ image }) => {
      if (world.level === arena) canvas.getContext('2d')!.drawImage(image, 0, 0);
    });
  }
  world.monsters = [];
  for (const d of world.dragons) {
    const pos = Dragon.spawnPos(lv, d.player.index);
    d.x = pos.x;
    d.y = pos.y;
    d.dir = pos.dir;
    d.up = 0;
  }
  world.boss = new SuperDrunk(world);
  world.audio.playMusic('modern', false);
}
