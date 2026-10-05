// ext7 - "Camel" biplanes: dogfight over the level's floor. Planes always fly
// forward; left/right rotate, jump flips the plane over, fire shoots a
// two-round burst. A hit sends the target down in flames (+1, +100);
// side walls and the ground are deadly. 90 seconds; solo against a CPU ace.

import type { Frame, Gfx } from '../engine/gfx';
import {
  Arena,
  CELL,
  COLS,
  FIELD_H,
  FIELD_W,
  FIELD_Y,
  ROWS,
  SPR,
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

export const BIPLANES: GameMeta = {
  id: 'biplanes',
  name: 'BIPLANES',
  desc: 'DOGFIGHT! SHOOT DOWN THE OTHER PLANE',
  mode: 'versus',
  time: 90,
  music: 'ext7',
  countLabel: 'KILLS',
  controls: 'LEFT/RIGHT ROTATE  JUMP FLIP  FIRE SHOOT',
};

const STEP = 15; // degrees per turn step
const SPEED = 2.4;
const TURN_EVERY = 3;
const SHOT_SPEED = 5.1;
const SHOT_LIFE = 33;
const FIRE_EVERY = 21;
const X_MIN = 2 * CELL - 3;
const X_MAX = (COLS - 2) * CELL - 36 + 3;
const Y_MAX = (ROWS - 1) * CELL - 36 + 7;
const rad = (a: number) => (a * Math.PI) / 180;

interface Plane {
  slot: Slot;
  x: number;
  y: number;
  angle: number;
  flipped: boolean;
  state: 'fly' | 'flames' | 'dead';
  blink: number;
  control: number; // frames before the pilot takes control
  turnT: number;
  fireT: number;
  bob: number;
  respawn: number;
  trail: [number, number][];
  lastHitBy: Slot | null;
  ai: { tx: number; ty: number; t: number };
}

interface Shot {
  owner: Plane;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class Biplanes extends MiniGame {
  private arena!: Arena;
  private frames!: Frame[][];
  private planes: Plane[] = [];
  private shots: Shot[] = [];
  private clouds = Array.from({ length: 6 }, () => ({ x: rand() * FIELD_W, y: 20 + rand() * 200, v: 0.1 + rand() * 0.25, s: 1 + rand() * 1.5 }));

  constructor(app: App, opts: GameOptions) {
    super(app, BIPLANES, opts);
    this.readyFrames = sec(1.8);
  }

  protected async init(): Promise<void> {
    [this.arena, this.frames] = await Promise.all([Arena.load(this.app), loadPlayerFrames(this.app.gfx, 'ext7/image1_{p}.png', 36, 36)]);
    this.arena.clear(2, COLS - 2, 0, ROWS - 1);
    for (let x = 2; x < COLS - 2; x++) this.arena.set(x, ROWS - 1, true);
    this.planes = this.slots.map((s) => this.makePlane(s, s.index === 0 ? X_MIN + 20 : X_MAX - 20, 120 + s.index * 60));
  }

  private makePlane(slot: Slot, x: number, y: number): Plane {
    const right = x < FIELD_W / 2;
    return {
      slot,
      x: Math.max(X_MIN, Math.min(X_MAX, x)),
      y: Math.max(4 * CELL, Math.min((ROWS - 4) * CELL - 36, y)),
      angle: right ? 0 : 180,
      flipped: !right,
      state: 'fly',
      blink: 40,
      control: 8,
      turnT: 0,
      fireT: 0,
      bob: 0,
      respawn: 0,
      trail: [],
      lastHitBy: null,
      ai: { tx: 0, ty: 0, t: 0 },
    };
  }

  private respawnPos(slot: Slot): [number, number] {
    const others = this.planes.filter((p) => p.slot !== slot && p.state !== 'dead');
    let dmin = 180;
    for (;;) {
      const x = rand() < 0.5 ? X_MIN : X_MAX;
      const y = 2 * CELL + rand() * ((ROWS - 4) * CELL - 36 - 2 * CELL);
      if (others.every((o) => (o.x - x) ** 2 + (o.y - y) ** 2 >= dmin * dmin)) return [x, y];
      dmin *= 0.94;
    }
  }

  private turn(p: Plane, d: number): void {
    p.angle = (p.angle + STEP * d + 360) % 360;
  }

  protected step(): void {
    for (const c of this.clouds) {
      c.x += c.v;
      if (c.x > FIELD_W + 60) c.x = -100;
    }
    for (const p of this.planes) this.updatePlane(p);
    for (const s of this.shots) this.updateShot(s);
    this.shots = this.shots.filter((s) => s.life > 0);
    // mid-air collisions
    const [a, b] = this.planes;
    if (a && b && a.state === 'fly' && b.state === 'fly' && !a.blink && !b.blink && Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 24) {
      this.sfx('ext6_crash', (a.x + b.x) / 2);
      this.fx.anim((a.x + b.x) / 2 + 2, (a.y + b.y) / 2 + 2, [...SPR.explosion, ...SPR.explosion], 4);
      this.flames(a);
      this.flames(b);
    }
  }

  private updatePlane(p: Plane): void {
    if (p.state === 'dead') {
      if (--p.respawn <= 0 && this.phase === 'play') {
        const [x, y] = this.respawnPos(p.slot);
        Object.assign(p, this.makePlane(p.slot, x, y));
        p.blink = sec(1.3);
        p.control = 20;
      }
      return;
    }
    if (!this.live) return;
    if (p.blink > 0) p.blink--;
    // controls
    if (p.state === 'fly' && this.live) {
      if (p.control > 0) p.control--;
      else {
        let want = 0;
        let fire = false;
        let flip = false;
        if (p.slot.cpu) [want, fire] = this.think(p);
        else {
          const pad = this.pad(p.slot);
          want = pad.dx;
          fire = pad.held.fire;
          flip = pad.pressed('jump');
        }
        if (flip) p.flipped = !p.flipped;
        if (want && ++p.turnT >= TURN_EVERY) {
          p.turnT = 0;
          this.turn(p, want);
        } else if (!want) p.turnT = TURN_EVERY - 1;
        if (p.fireT > 0) p.fireT--;
        else if (fire) this.fire(p);
      }
    } else if (p.state === 'flames') {
      if (rand() < 0.25) {
        const [x, y] = pick(p.trail.length ? p.trail : [[p.x, p.y]]);
        this.fx.anim(x + 2 + (rand() - 0.5) * 20, y + 2 + (rand() - 0.5) * 20, SPR.pop, 3);
      }
      if (rand() < 0.33) {
        const lst = p.angle >= 90 && p.angle < 270 ? [0, 0, 0, 0, -1, -1, -1, 1, 1] : [0, 0, 0, 0, -1, -1, 1, 1, 1];
        this.turn(p, pick(lst));
      }
      p.trail.push([p.x, p.y]);
      if (p.trail.length > 7) p.trail.shift();
    }
    // ceiling: nose back down
    if (p.y < 0 && !(p.angle > 0 && p.angle < 180) && (Math.abs(270 - p.angle) < -4 * p.y || rand() < 0.2)) {
      if ((p.angle >= 90 && p.angle < 270) || (p.angle === 270 && !p.flipped)) this.turn(p, -1);
      else this.turn(p, 1);
    }
    // the gentle bob after spawning
    if (p.bob < 72) {
      p.y += 3 * Math.pow(0.98, p.bob) * Math.sin(rad(p.bob * STEP)) * 0.66;
      p.bob++;
    }
    p.x += Math.cos(rad(p.angle)) * SPEED;
    p.y += Math.sin(rad(p.angle)) * SPEED;
    if (p.x < X_MIN || p.x > X_MAX) {
      // hit a side wall
      p.angle = p.x < X_MIN ? 2 * STEP : 180 - 2 * STEP;
      p.x = Math.max(X_MIN, Math.min(X_MAX, p.x));
      p.flipped = !p.flipped;
      this.sfx('pop', p.x);
      this.flames(p);
    } else if (p.y > Y_MAX) this.crash(p);
  }

  /** CPU ace: chase the player with some lead, avoid walls and ground. */
  private think(p: Plane): [number, boolean] {
    const foe = this.planes.find((o) => o !== p && o.state === 'fly');
    let desired: number;
    let aimDiff = 999;
    let dist = 999;
    const vx = Math.cos(rad(p.angle));
    const vy = Math.sin(rad(p.angle));
    if (--p.ai.t <= -sec(5) && foe) p.ai = { tx: 80 + rand() * 350, ty: 40 + rand() * 180, t: sec(1.2) }; // break off now and then
    if (foe && p.ai.t <= 0) {
      const lead = 12;
      const tx = foe.x + Math.cos(rad(foe.angle)) * SPEED * lead;
      const ty = foe.y + Math.sin(rad(foe.angle)) * SPEED * lead;
      desired = (Math.atan2(ty - p.y, tx - p.x) * 180) / Math.PI;
      dist = Math.hypot(foe.x - p.x, foe.y - p.y);
      aimDiff = Math.abs((((desired - p.angle + 540) % 360) + 360) % 360 - 180);
      if (foe.blink > 0) desired = p.y > 200 ? 270 : p.angle; // don't camp the spawn
    } else {
      if (p.ai.t <= 0 && !foe) p.ai = { tx: 80 + rand() * 350, ty: 60 + rand() * 200, t: sec(2) };
      desired = (Math.atan2(p.ai.ty - p.y, p.ai.tx - p.x) * 180) / Math.PI;
    }
    // safety first
    if (p.y > Y_MAX - 80 && vy > -0.2) desired = vx >= 0 ? 300 : 240;
    else if (p.x < X_MIN + 60 && vx < 0.3) desired = p.y > 200 ? 300 : 30;
    else if (p.x > X_MAX - 60 && vx > -0.3) desired = p.y > 200 ? 240 : 150;
    else if (p.y < 20 && vy < 0) desired = vx >= 0 ? 30 : 150;
    const diff = ((((desired - p.angle + 540) % 360) + 360) % 360) - 180;
    const want = Math.abs(diff) < 8 ? 0 : diff > 0 ? 1 : -1;
    const fire = aimDiff < 10 && dist < 180 && rand() < 0.45;
    if (rand() < 0.004) p.flipped = !p.flipped;
    return [want, fire];
  }

  private fire(p: Plane): void {
    const ax = Math.cos(rad(p.angle));
    const ay = Math.sin(rad(p.angle));
    let x = p.x + 18 + ax * 20;
    let y = p.y + 18 + ay * 20;
    const s = p.flipped ? -1 : 1;
    x -= ay * 5 * s;
    y += ax * 5 * s;
    const vx = ax * SHOT_SPEED;
    const vy = ay * SHOT_SPEED;
    this.shots.push({ owner: p, x: x + vx * 3, y: y + vy * 3, vx, vy, life: SHOT_LIFE - 3 });
    this.shots.push({ owner: p, x, y, vx, vy, life: SHOT_LIFE });
    p.fireT = FIRE_EVERY;
    this.sfx('ext7_fire', p.x);
  }

  private updateShot(s: Shot): void {
    s.life--;
    s.x += s.vx;
    s.y += s.vy;
    if (s.x < 2 * CELL || s.x > (COLS - 2) * CELL || s.y > (ROWS - 1) * CELL) {
      s.life = 0;
      return;
    }
    for (const p of this.planes) {
      if (p === s.owner || p.state === 'dead' || p.blink > 0) continue;
      if (s.x > p.x + 5 && s.x < p.x + 31 && s.y > p.y + 7 && s.y < p.y + 29) {
        s.life = 0;
        this.sfx('ext7_hit', s.x);
        if (p.state === 'fly') {
          const k = s.owner.slot;
          k.count++;
          this.give(k, 100, s.x, s.y - 12);
          p.lastHitBy = k;
          this.flames(p);
        }
        return;
      }
    }
  }

  private flames(p: Plane): void {
    if (p.state !== 'fly') return;
    p.state = 'flames';
    p.trail = Array.from({ length: 7 }, () => [p.x, p.y] as [number, number]);
    this.fx.anim(p.x - 14, p.y - 14, [913, 914, 915], 3);
  }

  private crash(p: Plane): void {
    p.state = 'dead';
    p.respawn = sec(1);
    this.sfx('ext6_crash', p.x);
    this.fx.anim(p.x + 2, Y_MAX - 4, [...SPR.explosion, ...SPR.explosion], 4);
  }

  protected render(g: Gfx): void {
    // sky
    const ctx = g.ctx;
    const grd = ctx.createLinearGradient(0, FIELD_Y, 0, FIELD_Y + FIELD_H);
    grd.addColorStop(0, '#0b1650');
    grd.addColorStop(0.7, '#2a4a9a');
    grd.addColorStop(1, '#c87a5a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, FIELD_Y, FIELD_W, FIELD_H);
    for (const c of this.clouds) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(c.x + i * 18 * c.s, FIELD_Y + c.y + (i % 2) * 6, 22 * c.s, 10 * c.s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    this.arena.draw(g);
    for (const p of this.planes) {
      if (p.state === 'dead') continue;
      if (p.blink > 0 && (p.blink >> 1) & 1) continue;
      let a = Math.round(p.angle / STEP) % 24;
      if (p.flipped && a) a = 24 - a;
      g.drawFrame(this.frames[p.slot.index][a], p.x, FIELD_Y + p.y, { flipY: p.flipped });
    }
    for (const s of this.shots) {
      g.rect(s.x - 3, FIELD_Y + s.y - 3, 6, 6, '#311');
      g.rect(s.x - 2, FIELD_Y + s.y - 2, 4, 4, s.owner.slot.index ? '#8df' : '#ff6');
      g.rect(s.x - 1, FIELD_Y + s.y - 1, 2, 2, '#fff');
    }
  }
}
