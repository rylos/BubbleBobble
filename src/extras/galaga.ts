// ext3 - Galaga: the walls fall away, the dragon becomes a ship and shoots
// bubbles at squadrons of Flappies and Ghosties that swoop in and join a
// shifting formation. Each alien is +100. Waves keep coming (faster, with
// divers) until the ships are lost or the formation reaches the ground.

import type { Frame, Gfx } from '../engine/gfx';
import {
  Arena,
  FIELD_H,
  FIELD_W,
  FIELD_Y,
  PCOLORS,
  SPR,
  Starfield,
  clamp,
  loadPlayerFrames,
  rand,
  sec,
  MiniGame,
  type GameMeta,
  type GameOptions,
  type Slot,
} from './common';
import type { App } from '../scenes';
import { SCREEN_H } from '../engine/gfx';

export const GALAGA: GameMeta = {
  id: 'galaga',
  name: 'GALAGA',
  desc: 'BUBBLE THE INVADING SQUADRONS',
  mode: 'solo',
  time: null,
  music: 'ext3',
  countLabel: 'HITS',
  controls: 'LEFT/RIGHT MOVE  FIRE SHOOT',
};

const ANGLES = 32;
const SHIP_Y = FIELD_H - 32;
const SHIP_SPEED = 3;
const SHOT_SPEED = 7;
const FIRE_DELAY = 16;
const LIVES = 3;
const CENTER = FIELD_W / 2;

interface Ship {
  slot: Slot;
  x: number;
  alive: boolean;
  lives: number;
  timer: number; // respawn delay or spawn shield
  cool: number;
}

interface Shot {
  slot: Slot;
  x: number;
  y: number;
}

interface Drop {
  x: number;
  y: number;
}

type Target = { rel: boolean; x: number; y: number };

interface Alien {
  x: number;
  y: number;
  angle: number;
  path: Target[];
  slot: Target; // formation slot (relative)
  inPlace: boolean;
  ghosty: boolean;
  dir: number;
  wait: number;
  diving: boolean;
  frame: number;
}

export class Galaga extends MiniGame {
  private arena!: Arena;
  private frames!: Frame[][];
  private stars = new Starfield();
  private wallsY = 0;
  private ships: Ship[] = [];
  private shots: Shot[] = [];
  private drops: Drop[] = [];
  private aliens: Alien[] = [];
  private gx = CENTER;
  private gy = 0;
  private shiftDir = 1;
  private shiftDown = 0;
  private wave = 0;
  private squadrons = 0;
  private nextSquad = 0;
  private relY = 0;
  private squadTime = 0;
  private waveBanner = 0;
  private diveTimer = sec(6);

  constructor(app: App, opts: GameOptions) {
    super(app, GALAGA, opts);
    this.readyFrames = sec(2);
    this.ships = this.slots.map((s) => ({ slot: s, x: this.slots.length === 1 ? CENTER - 16 : s.index === 0 ? 150 : 330, alive: true, lives: LIVES, timer: sec(1), cool: 0 }));
  }

  protected async init(): Promise<void> {
    [this.arena, this.frames] = await Promise.all([Arena.load(this.app), loadPlayerFrames(this.app.gfx, 'ext3/image1_{p}.png', 32, 32)]);
    this.startWave();
  }

  private get speed(): number {
    return 3.4 + Math.min(1.6, this.wave * 0.25);
  }

  private startWave(): void {
    this.wave++;
    this.squadrons = 3 + Math.floor((this.slots.length + 1) / 3) + Math.floor((this.wave - 1) / 2);
    this.nextSquad = 0;
    this.relY = 0;
    this.squadTime = this.wave === 1 ? sec(1) : sec(1.5);
    this.gx = CENTER;
    this.gy = 0;
    this.shiftDir = 1;
    this.shiftDown = 0;
    this.waveBanner = sec(2);
  }

  private spawnSquadron(sq: number): void {
    const dx = sq % 2 ? -1 : 1;
    const halfspan = Math.floor((CENTER * 7) / 12);
    for (let rank = 0; ; rank++) {
      const relx = -halfspan + 64 * rank;
      if (relx > halfspan) break;
      const slot: Target = { rel: true, x: -dx * relx, y: -this.relY };
      this.aliens.push({
        x: CENTER - 16,
        y: -112,
        angle: ANGLES / 4 * 3,
        path: [
          { rel: false, x: CENTER + (dx * CENTER * 2) / 3, y: FIELD_H / 3 },
          { rel: false, x: CENTER - (dx * CENTER * 4) / 5, y: FIELD_H / 6 },
          slot,
        ],
        slot,
        inPlace: false,
        ghosty: sq % 3 === 2,
        dir: dx < 0 ? -1 : 1,
        wait: rank * 30,
        diving: false,
        frame: rank * 3,
      });
    }
  }

  protected step(): void {
    this.stars.update(this.wallsY < FIELD_H ? 0.5 : 1);
    // the walls fall away first
    if (this.wallsY < FIELD_H + 16) {
      this.wallsY += 7.5;
      return;
    }
    if (this.waveBanner > 0) this.waveBanner--;
    for (const s of this.ships) this.updateShip(s);
    for (const s of this.shots) s.y -= SHOT_SPEED;
    this.shots = this.shots.filter((s) => s.y > -32 && !this.shotHits(s));
    for (const d of this.drops) d.y += 4.7;
    this.drops = this.drops.filter((d) => d.y < FIELD_H - 14);
    if (!this.live) return;
    this.formation();
    for (const a of [...this.aliens]) this.updateAlien(a);
  }

  private formation(): void {
    const inPlace = this.aliens.filter((a) => a.inPlace);
    const moving = this.aliens.filter((a) => !a.inPlace);
    const tooHigh = this.gy - this.relY < -48;
    if (inPlace.length) {
      const xs = inPlace.map((a) => a.x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const sp = 1.3 + this.wave * 0.1;
      if (this.shiftDown > 0) {
        this.gy += 0.7;
        this.shiftDown -= 0.7;
      } else if (this.shiftDir > 0) {
        this.gx += sp;
        if (hi >= FIELD_W - 5 * 16) {
          this.shiftDir = -1;
          this.shiftDown = 48;
        }
      } else {
        this.gx -= sp;
        if (lo <= 3 * 16) {
          this.shiftDir = 1;
          this.shiftDown = 48;
        }
      }
    } else if (tooHigh) this.gy += 1;
    this.squadTime--;
    if (this.nextSquad >= this.squadrons) {
      if (!this.aliens.length) {
        this.app.audio.sfx('extralife');
        this.startWave();
      }
    } else if (this.squadTime < 0 && !tooHigh) {
      this.squadTime = sec(5);
      this.spawnSquadron(this.nextSquad++);
      this.relY += 64;
    }
    // occasional divers once a formation is in place
    if (inPlace.length && !moving.some((a) => a.diving) && --this.diveTimer <= 0) {
      this.diveTimer = Math.max(sec(1.5), sec(5) - this.wave * 20);
      const a = inPlace[Math.floor(rand() * inPlace.length)];
      const ships = this.ships.filter((s) => s.alive);
      const tx = ships.length ? ships[Math.floor(rand() * ships.length)].x : a.x;
      a.inPlace = false;
      a.diving = true;
      a.path = [
        { rel: false, x: clamp(a.x + (tx - a.x) * 0.5, 20, FIELD_W - 52), y: FIELD_H * 0.55 },
        { rel: false, x: tx, y: FIELD_H + 80 },
      ];
      this.sfx('jump', a.x);
    }
  }

  private updateAlien(a: Alien): void {
    a.frame++;
    if (a.wait > 0) {
      a.wait--;
      return;
    }
    const sp = this.speed;
    const t = a.path[0];
    let dx = (t.rel ? this.gx + t.x : t.x) - a.x;
    let dy = (t.rel ? this.gy + t.y : t.y) - a.y;
    let best = Infinity;
    let ang = a.angle;
    for (const d of [-1, 0, 1]) {
      const an = (a.angle + d + ANGLES) % ANGLES;
      const tx = sp * Math.cos((an * 2 * Math.PI) / ANGLES) - dx;
      const ty = -sp * Math.sin((an * 2 * Math.PI) / ANGLES) - dy;
      const v = tx * tx + ty * ty;
      if (v < best) {
        best = v;
        ang = an;
      }
    }
    a.angle = ang;
    if (dx * dx + dy * dy > sp * sp) {
      dx = sp * Math.cos((ang * 2 * Math.PI) / ANGLES);
      dy = -sp * Math.sin((ang * 2 * Math.PI) / ANGLES);
    } else if (t.rel) {
      a.inPlace = true;
      a.diving = false;
      if (a.y > SHIP_Y - 8 && this.ships.some((s) => s.alive)) {
        for (const s of this.ships)
          if (s.alive) {
            this.explode(s);
            s.lives = 0;
          }
        this.finish('INVADED!');
      }
    } else {
      a.path.shift();
    }
    a.x += dx;
    a.y += dy;
    if (a.diving && a.y > FIELD_H + 40) {
      // wrap to the top and fly back to the formation slot
      a.y = -64;
      a.path = [a.slot];
    }
    if (dx && a.dir > 0 !== dx > 0) a.dir = -a.dir;
    const prob = (a.inPlace ? 0.0057 : 0.014) * (a.diving ? 2.5 : 1) * (1 + this.wave * 0.15);
    if (rand() < prob && a.y >= 0 && a.y < SHIP_Y - 60) this.drops.push({ x: a.x + 12, y: a.y + 24 });
  }

  private shotHits(s: Shot): boolean {
    const cx = s.x + 16;
    const cy = s.y + 16;
    for (const a of this.aliens) {
      if (a.wait > 0) continue;
      if (cx > a.x - 1 && cx < a.x + 33 && cy > a.y - 1 && cy < a.y + 33) {
        this.aliens.splice(this.aliens.indexOf(a), 1);
        s.slot.count++;
        this.give(s.slot, 100, a.x + 16, a.y + 16);
        this.fx.anim(a.x, a.y, SPR.pop, 3);
        const dead = a.ghosty ? SPR.ghosty.dead : SPR.flappy.dead;
        this.fx.anim(a.x, a.y, [...dead, ...dead, ...dead], 4, 0, (rand() - 0.5) * 2, 1.5);
        this.sfx('pop', a.x);
        return true;
      }
    }
    return false;
  }

  private updateShip(s: Ship): void {
    if (s.timer > 0) s.timer--;
    if (!s.alive) {
      if (s.lives > 0 && s.timer <= 0 && this.live) {
        s.alive = true;
        s.timer = sec(2);
        this.sfx('appear', s.x);
      }
      return;
    }
    if (s.cool > 0) s.cool--;
    if (!this.live) return;
    const pad = this.pad(s.slot);
    s.x = clamp(s.x + SHIP_SPEED * pad.dx, 8, FIELD_W - 8 - 32);
    const mine = this.shots.filter((q) => q.slot === s.slot).length;
    if ((pad.pressed('fire') || pad.held.fire) && s.cool === 0 && mine < 2) {
      this.shots.push({ slot: s.slot, x: s.x, y: SHIP_Y - 16 });
      s.cool = FIRE_DELAY;
      this.sfx('ext3_shoot', s.x);
    }
    if (s.timer > 0) return; // spawn shield
    const hx = s.x + 3;
    const hy = SHIP_Y + 3;
    const hit =
      this.aliens.some((a) => a.wait <= 0 && a.x + 4 < hx + 26 && hx < a.x + 28 && a.y + 4 < hy + 26 && hy < a.y + 28) ||
      this.drops.some((d) => d.x + 2 < hx + 26 && hx < d.x + 7 && d.y + 2 < hy + 26 && hy < d.y + 14);
    if (hit) this.explode(s);
  }

  private explode(s: Ship): void {
    s.alive = false;
    s.lives--;
    s.timer = sec(1.9);
    this.sfx('pop', s.x);
    this.sfx('die', s.x);
    this.fx.burst(s.x, SHIP_Y, 32, 32, 11);
    if (s.lives <= 0) {
      s.slot.out = true;
      if (this.ships.every((q) => q.lives <= 0)) this.finish('GAME OVER');
    }
  }

  protected render(g: Gfx): void {
    g.rect(0, FIELD_Y, FIELD_W, FIELD_H, '#000008');
    this.stars.draw(g, this.t);
    if (this.wallsY < FIELD_H + 16) {
      g.ctx.save();
      g.ctx.beginPath();
      g.ctx.rect(0, FIELD_Y, FIELD_W, FIELD_H);
      g.ctx.clip();
      this.arena.draw(g, this.wallsY);
      g.ctx.restore();
    }
    for (const d of this.drops) g.draw(SPR.fireDrop, d.x, FIELD_Y + d.y);
    for (const a of this.aliens) {
      if (a.wait > 0 && a.y < -32) continue;
      const set = a.ghosty ? SPR.ghosty : SPR.flappy;
      const fr = a.dir > 0 ? set.right : set.left;
      g.draw(fr[Math.floor(a.frame / 6) % 4], a.x, FIELD_Y + a.y);
    }
    for (const s of this.shots) g.draw(SPR.newBubble[1], s.x, FIELD_Y + s.y, { p: s.slot.index });
    for (const s of this.ships) {
      if (!s.alive || (s.timer > 0 && (this.t >> 2) & 1)) continue;
      g.drawFrame(this.frames[s.slot.index][0], s.x, FIELD_Y + SHIP_Y);
    }
    if (this.waveBanner > 0 && this.live) g.text(`WAVE ${this.wave}`, FIELD_W / 2, FIELD_Y + 170, (this.t >> 3) & 1 ? '#ff5' : '#fa3', { align: 'center', scale: 3 });
  }

  protected drawHud(g: Gfx): void {
    super.drawHud(g);
    if (this.phase === 'loading') return;
    g.text(`WAVE ${this.wave}`, FIELD_W / 2, SCREEN_H - 13, '#ccc', { align: 'center', scale: 1.5 });
    for (const s of this.ships) {
      const left = s.slot.index === 0;
      const rest = Math.max(0, s.lives - (s.alive ? 1 : 0));
      for (let k = 0; k < rest; k++) {
        const x = left ? 130 + k * 18 : FIELD_W - 146 - k * 18;
        g.drawFrame(this.frames[s.slot.index][0], x, SCREEN_H - 16, { scale: 0.5 });
      }
      if (s.slot.out) g.text('OUT', left ? 130 : FIELD_W - 130, SCREEN_H - 13, PCOLORS[s.slot.index], { align: left ? 'left' : 'right', scale: 1.5 });
    }
  }
}
