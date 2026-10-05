// Monsters. A tick-based port of monsters.py: every frame runs `speed` logic
// ticks (angry monsters run twice as many), exactly like the original's
// "angry generators" trick.

import type { Gfx } from '../engine/gfx';
import { CELL, MONSTER } from './const';
import { Entity, choice, rand, range } from './entity';
import type { MonsterType } from './level';
import type { Bubble, PopList } from './bubble';
import type { Dragon } from './dragon';
import type { World } from './world';
import { DeadMonster } from './items';

interface MonsterDef {
  base: number; // right = base..+3, left = +4..+7, jailed = +8..+10, dead = +14..+17
  angry: number; // right_angry = angry..+3, left_angry = +4..+7
  vx: number;
  vy: number;
  flying: boolean;
  shot: 'normal' | 'fast' | 'boomerang' | 'down' | null;
  sameLR?: boolean;
}

export const MONSTERS: Record<MonsterType, MonsterDef> = {
  nasty: { base: 239, angry: 800, vx: 2, vy: 0, flying: false, shot: null },
  monky: { base: 265, angry: 808, vx: 2, vy: 0, flying: false, shot: 'normal' },
  ghosty: { base: 291, angry: 816, vx: 2, vy: 2, flying: true, shot: null },
  flappy: { base: 317, angry: 824, vx: 2, vy: 1, flying: true, shot: null },
  springy: { base: 343, angry: 832, vx: 2, vy: 0, flying: false, shot: null },
  orcy: { base: 373, angry: 844, vx: 2, vy: 0, flying: false, shot: 'fast' },
  gramy: { base: 399, angry: 852, vx: 3, vy: 0, flying: false, shot: 'boomerang' },
  blitzy: { base: 425, angry: 860, vx: 3, vy: 0, flying: false, shot: 'down', sameLR: true },
};

type State = 'enter' | 'wait' | 'walk' | 'fall' | 'hjump' | 'vjump' | 'shoot' | 'fly' | 'spring' | 'bubbled' | 'frozen';

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export class Monster extends Entity {
  readonly def: MonsterDef;
  dir: 1 | -1;
  vdir = -1;
  angry = false;
  state: State = 'enter';
  private acc = 0;
  private t = 0; // ticks in current state
  private animT = 0;
  private noShootBefore = 0;
  private ticks = 0;
  // state-specific
  private targetY = 0;
  private enterDelay = 0;
  private vspeed = 0;
  private yf = 0;
  private limitY = 0;
  private nextDir: 1 | -1 = 1;
  private springPhase = 0;
  private springDown = 0;
  private flyBlocked = false;
  private shootPause = 0;

  constructor(
    readonly type: MonsterType,
    x: number,
    y: number,
    dir: 1 | -1,
    enterDelay = 0,
  ) {
    super();
    this.def = MONSTERS[type];
    this.x = x;
    this.y = y;
    this.dir = dir;
    this.targetY = y;
    this.enterDelay = enterDelay;
  }

  /** Start above the screen and drop to (x, targetY). */
  startEntering(): void {
    this.state = 'enter';
    this.y = -40 - (this.enterDelay % 4) * 8;
  }

  get harmful(): boolean {
    return this.state !== 'enter' && this.state !== 'bubbled' && this.state !== 'frozen';
  }
  get capturable(): boolean {
    return this.state !== 'enter' && this.state !== 'bubbled';
  }
  /** Regular monster for hurry-up / board-clear logic. */
  get active(): boolean {
    return !this.dead;
  }

  update(world: World): void {
    this.age++;
    if (this.state === 'enter') {
      if (this.enterDelay > 0) {
        this.enterDelay--;
        return;
      }
      this.y = Math.min(this.targetY, this.y + 4);
      this.animT++;
      if (this.y >= this.targetY) this.setState('wait');
      return;
    }
    if (this.state === 'bubbled') {
      this.animT++;
      return;
    }
    if (this.state === 'frozen') return;
    this.acc += (this.angry ? MONSTER.angrySpeed : MONSTER.speed) * world.monsterSpeedScale;
    while (this.acc >= 1 && !this.dead && (this.state as State) !== 'bubbled') {
      this.acc -= 1;
      this.tick(world);
    }
  }

  private setState(s: State): void {
    this.state = s;
    this.t = 0;
  }

  private defaultMode(): void {
    if (this.def.flying) this.setState('fly');
    else this.setState('fall');
  }

  private tick(world: World): void {
    const lv = world.level;
    this.t++;
    this.ticks++;
    this.animT++;
    switch (this.state) {
      case 'wait':
        if (this.t >= MONSTER.waitFrames) this.defaultMode();
        break;

      case 'walk': {
        if (!lv.onGround(this.x, this.y)) {
          if (this.seeDragon(world)) {
            this.setState('hjump');
            this.vspeed = -2.2;
            this.yf = this.y - 1;
            this.limitY = this.y;
          } else this.setState('fall');
          break;
        }
        if (this.type === 'springy') {
          this.setState('spring');
          this.springPhase = 0;
          break;
        }
        if (rand() < 0.2 && this.overlapping(world)) break;
        let x1 = this.x;
        if (this.dir > 0) x1 += this.def.vx;
        if ((x1 & 15) < this.def.vx && rand() < 0.2) {
          this.x = x1 & -16;
          if (this.special(world)) break;
        }
        this.tryHStep(world);
        break;
      }

      case 'fall': {
        if (lv.onGround(this.x, this.y)) {
          this.setState('walk');
          break;
        }
        let ny = this.y + MONSTER.fallSpeed;
        if ((ny & 15) > 14) ny = (floorDiv(ny, 16) + 1) * 16;
        else if ((ny & 15) < 3) ny = floorDiv(ny, 16) * 16;
        let nx = this.x;
        if (nx < 32) nx += 1;
        else if (nx > lv.pw - 64) nx -= 1;
        this.x = nx;
        this.y = lv.warpY(ny);
        break;
      }

      case 'hjump': {
        if (this.yf <= this.limitY && !this.blocked(world)) {
          this.x += 2 * this.dir;
          this.y = Math.trunc(this.yf);
          this.vspeed += 0.19;
          this.yf = this.y + this.vspeed;
        } else this.defaultMode();
        break;
      }

      case 'vjump': {
        // turn-around animation then rise 4 px per tick to the platform
        if (this.t === 1) this.dir = -this.dir as 1 | -1;
        else if (this.t === 11) this.dir = -this.dir as 1 | -1;
        else if (this.t === 15) this.dir = this.nextDir;
        else if (this.t > 15) {
          const ny = this.y - 4;
          if (ny <= this.limitY - 4) {
            this.defaultMode();
            break;
          }
          this.y = ny < -32 ? lv.warpY(ny) : ny;
        }
        break;
      }

      case 'shoot':
        if (this.t >= this.shootPause) {
          world.monsterShoot(this);
          this.defaultMode();
        }
        break;

      case 'fly': {
        if (rand() < 0.2 && this.overlapping(world)) break;
        const h = this.tryHStep(world);
        const v = this.tryVStep(world);
        if (h || v) this.flyBlocked = false;
        else if (this.flyBlocked) {
          if (this.x < 32) this.x += this.def.vy;
          else if (this.x > lv.pw - 64) this.x -= this.def.vy;
          else this.y = lv.warpY(this.y - this.def.vy);
        } else this.flyBlocked = true;
        // flying monsters may also shoot (none by default) or nothing else
        break;
      }

      case 'spring':
        this.springTick(world);
        break;
    }
  }

  private springTick(world: World): void {
    const lv = world.level;
    const ov = this.overlapping(world) ? 1 : 0;
    // squash 2 + 4 + 2 ticks, then a 40-tick parabola
    if (this.springPhase === 0) {
      this.springDown = 1;
      if (this.t >= 2 + ov) {
        this.springPhase = 1;
        this.t = 0;
      }
    } else if (this.springPhase === 1) {
      this.springDown = 2;
      if (this.t >= 4 + 2 * ov) {
        this.springPhase = 2;
        this.t = 0;
      }
    } else if (this.springPhase === 2) {
      this.springDown = 1;
      if (this.t >= 2 + ov) {
        this.springPhase = 3;
        this.t = 0;
        this.springDown = 0;
        this.vspeed = (-20 * 10) / 43;
        this.yf = this.y;
      }
    } else {
      const g = 10 / 43;
      this.yf += this.vspeed;
      this.vspeed += g;
      if (this.blocked(world)) this.dir = -this.dir as 1 | -1;
      let nx = this.x + this.dir * this.def.vx;
      if (floorDiv(this.y, 16) < floorDiv(Math.trunc(this.yf), 16)) {
        const gy = (floorDiv(this.y, 16) + 1) * 16;
        if (lv.onGround(this.x, gy)) {
          this.setState('fall');
          return;
        }
        if (lv.onGround(nx, gy)) {
          this.x = nx;
          this.setState('fall');
          return;
        }
      }
      if (this.yf >= lv.ph) this.yf -= lv.wrapH;
      else if (this.yf < -32) this.yf += lv.wrapH;
      nx = Math.max(32, Math.min(lv.pw - 64, nx));
      this.x = nx;
      this.y = Math.trunc(this.yf);
      if (this.t >= 40) this.setState('fall');
    }
  }

  private blocked(world: World): boolean {
    const lv = world.level;
    const x0 = this.dir < 0 ? floorDiv(this.x - 1, 16) : floorDiv(this.x + 33, 16);
    const y0 = floorDiv(this.y, 16) + 1;
    const y1 = floorDiv(this.y + 31, 16);
    return lv.wall(x0, y0) || lv.wall(x0, y1);
  }

  private tryHStep(world: World): boolean {
    if (this.blocked(world)) {
      this.dir = -this.dir as 1 | -1;
      return false;
    }
    this.x += this.def.vx * this.dir;
    return true;
  }

  private vBlocked(world: World): boolean {
    const lv = world.level;
    const y0 = this.vdir < 0 ? floorDiv(this.y, 16) : floorDiv(this.y + 1, 16) + 2;
    const x0 = floorDiv(this.x, 16);
    const x1 = x0 + 1;
    const x2 = floorDiv(this.x + 31, 16);
    return lv.wall(x0, y0) || lv.wall(x1, y0) || lv.wall(x2, y0);
  }

  private tryVStep(world: World): boolean {
    if (this.vBlocked(world)) {
      this.vdir = -this.vdir;
      return false;
    }
    this.y = world.level.warpY(this.y + this.def.vy * this.vdir);
    return true;
  }

  private overlapping(world: World): boolean {
    for (const s of world.monsters) {
      if (s === this) return false; // only the later of two stacked monsters waits
      if (s.type === this.type && s.angry === this.angry && Math.abs(s.x - this.x) <= 6 && Math.abs(s.y - this.y) < 6)
        return true;
    }
    return false;
  }

  private target: Dragon | null = null;

  private tagDragon(world: World): Dragon | null {
    const list = world.dragons.filter((d) => d.visible);
    this.target = list.length ? choice(list) : null;
    return this.target;
  }

  private seeDragon(world: World, d: Dragon | null = null): boolean {
    if (this.type === 'blitzy') return false;
    d = d ?? this.tagDragon(world);
    if (!d) return false;
    return Math.abs(d.y - this.y) < 16 && this.dir * (d.x - this.x) > 0;
  }

  private special(world: World): boolean {
    const lv = world.level;
    if (this.type === 'blitzy') {
      if (rand() < 0.3) world.monsterShoot(this);
      return false;
    }
    const d = this.tagDragon(world);
    if (!d) return false;
    if (this.seeDragon(world, d) && this.def.shot && this.ticks >= this.noShootBefore) {
      this.noShootBefore = this.ticks + 29;
      this.shootPause = 10;
      this.setState('shoot');
      return true;
    }
    if (d.y < this.y - CELL) {
      for (let ty = this.y - 2 * CELL; ty > this.y - 6 * CELL; ty -= CELL) {
        if (lv.onGround(this.x, ty)) {
          this.nextDir = rand() < 0.5 ? this.dir : d.x < this.x ? -1 : 1;
          this.limitY = ty;
          this.setState('vjump');
          return true;
        }
      }
    }
    return false;
  }

  // --- bubbles -----------------------------------------------------------

  capture(bubble: Bubble, world: World): void {
    this.state = 'bubbled';
    this.angry = false;
    this.x = bubble.x;
    this.y = bubble.y;
    world.onMonsterCaptured(this);
  }

  /** The bubble timed out: break free, angry. */
  escape(world: World, bubble: Bubble | null): void {
    if (this.dead) return;
    if (bubble) {
      this.x = Math.max(32, Math.min(world.level.pw - 64, bubble.x));
      this.y = bubble.y;
    }
    this.angry = true;
    this.acc = 0;
    this.defaultMode();
  }

  freeze(): void {
    if (this.state !== 'bubbled' && this.state !== 'enter') this.setState('frozen');
  }

  /** Killed by a popped bubble chain (or fire/water/lightning when popList is null). */
  killedBy(world: World, popList: PopList | null): void {
    if (this.dead) return;
    const list = popList ?? { dragon: null, kills: 0 };
    const level = list.kills++;
    world.add(new DeadMonster(this, level, list.dragon));
    this.kill();
    world.onMonsterKilled(this, list);
  }

  // --- drawing ------------------------------------------------------------

  private walkFrames(): number[] {
    const d = this.def;
    const right = this.dir > 0 || d.sameLR;
    const base = this.angry ? d.angry : d.base;
    if (this.type === 'blitzy') return range(this.angry ? 860 : 425, 4);
    return range(base + (right ? 0 : 4), 4);
  }

  get deadFrames(): number[] {
    return range(this.def.base + (this.type === 'blitzy' ? 10 : 14), 4);
  }

  private sprite(): number {
    if (this.type === 'springy' && this.springDown && this.state === 'spring') {
      const b = this.angry ? (this.dir > 0 ? 840 : 842) : this.dir > 0 ? 369 : 371;
      return b + this.springDown - 1;
    }
    const f = this.walkFrames();
    if (this.state === 'frozen' || this.state === 'wait') return f[0];
    if (this.state === 'vjump' && this.t <= 15) return f[0];
    return f[Math.floor(this.animT / 3) % f.length];
  }

  drawJailed(g: Gfx, x: number, y: number, world: World): void {
    const j = this.def.base + (this.type === 'blitzy' ? 4 : 8);
    const seq = [j + 1, j + 2, j + 1, j];
    g.draw(seq[Math.floor(world.frame / 6) % 4], x, y);
  }

  draw(g: Gfx, world: World): void {
    if (this.state === 'bubbled') return; // drawn by its bubble
    const frozen = this.state === 'frozen';
    g.draw(this.sprite(), this.x, this.y, { alpha: frozen && world.frame & 8 ? 0.6 : undefined });
    if (this.y > world.level.ph - 32) g.draw(this.sprite(), this.x, this.y - world.level.wrapH);
  }
}

