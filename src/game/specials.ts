// Special bubble effects, monster shots, Baron von Blubba and other moving hazards.

import type { Gfx } from '../engine/gfx';
import { CELL } from './const';
import { Entity, rand, range } from './entity';
import type { PopList } from './bubble';
import type { Dragon } from './dragon';
import type { Monster } from './monster';
import type { World } from './world';

const floorDiv = (a: number, b: number) => Math.floor(a / b);

// --- fire -------------------------------------------------------------------

export class FireDrop extends Entity {
  constructor(
    x: number,
    y: number,
    readonly popList: PopList,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.w = 9;
    this.h = 16;
  }
  update(world: World): void {
    const lv = world.level;
    this.age++;
    const cx = floorDiv(this.x + 4, CELL);
    const cy = floorDiv(this.y + 16, CELL);
    if (this.y >= 0 && lv.wall(cx, cy) && !lv.wall(cx, cy - 1)) {
      this.kill();
      FireFlame.spread(world, cx, cy - 1, this.popList);
      return;
    }
    this.y += 6;
    if (this.y >= lv.ph) this.kill();
  }
  draw(g: Gfx): void {
    g.draw(489, this.x, this.y);
  }
}

export class FireFlame extends Entity {
  private life: number;
  constructor(
    cx: number,
    cy: number,
    readonly popList: PopList,
    delay: number,
  ) {
    super();
    this.x = cx * CELL;
    this.y = cy * CELL;
    this.w = 16;
    this.h = 16;
    this.age = -delay;
    this.life = 70 + Math.floor(rand() * 20);
  }

  static spread(world: World, cx: number, cy: number, popList: PopList, reach = 5): void {
    const lv = world.level;
    world.add(new FireFlame(cx, cy, popList, 0));
    world.sfx('fire');
    for (const dir of [-1, 1]) {
      for (let i = 1; i <= reach; i++) {
        const x = cx + dir * i;
        if (lv.wall(x, cy) || !lv.wall(x, cy + 1)) break;
        world.add(new FireFlame(x, cy, popList, i * 3));
      }
    }
  }

  update(world: World): void {
    this.age++;
    if (this.age < 0) return;
    if (this.age > this.life) {
      this.kill();
      return;
    }
    for (const m of world.monsters)
      if (m.harmful && this.overlaps({ x: m.x + 4, y: m.y + 4, w: 24, h: 28 })) m.killedBy(world, this.popList);
  }
  draw(g: Gfx): void {
    if (this.age < 0) return;
    g.draw(490 + (floorDiv(this.age, 4) % 4), this.x, this.y);
  }
}

// --- water ------------------------------------------------------------------

export class WaterStream extends Entity {
  private cells: [number, number][] = [];
  private head: [number, number];
  private hdir: number;
  private reversals = 0;
  private finished = false;
  private carriedMonsters: Monster[] = [];
  private carriedDragons: Dragon[] = [];
  private static readonly LEN = 19;

  constructor(
    world: World,
    x: number,
    y: number,
    readonly popList: PopList,
  ) {
    super();
    const lv = world.level;
    let cx = floorDiv(x + 8, CELL);
    let cy = floorDiv(y + 8, CELL);
    cx = Math.max(2, Math.min(lv.w - 3, cx));
    cy = Math.max(0, cy);
    this.head = [cx, cy];
    this.hdir = popList.dragon ? popList.dragon.dir : 1;
    this.cells.push([cx, cy]);
  }

  update(world: World): void {
    this.age++;
    const lv = world.level;
    if (this.age % 2 === 0) {
      if (!this.finished) {
        const [hx, hy] = this.head;
        let next: [number, number] | null = null;
        if (hy + 1 >= lv.h) {
          this.finished = true;
        } else if (!lv.wall(hx, hy + 1)) next = [hx, hy + 1];
        else if (!lv.wall(hx + this.hdir, hy)) next = [hx + this.hdir, hy];
        else if (this.reversals < 3) {
          this.reversals++;
          this.hdir = -this.hdir;
          if (!lv.wall(hx + this.hdir, hy)) next = [hx + this.hdir, hy];
        } else this.finished = true;
        if (next) {
          this.head = next;
          this.cells.unshift(next);
          if (this.cells.length > WaterStream.LEN) this.cells.pop();
        }
      } else {
        this.cells.pop();
      }
      if (this.cells.length === 0) {
        this.end(world);
        return;
      }
    }
    // carry anything the head touches
    const [hx, hy] = this.cells[0] ?? this.head;
    const hxp = hx * CELL - 8;
    const hyp = hy * CELL - 16;
    const box = { x: hx * CELL - 8, y: hy * CELL - 8, w: 32, h: 24 };
    for (const m of world.monsters)
      if (m.harmful && !this.carriedMonsters.includes(m) && Entity.prototype.overlaps.call(m, box, 4)) {
        this.carriedMonsters.push(m);
        m.freeze();
      }
    for (const d of world.dragons)
      if (d.alive && !d.inWater && Entity.prototype.overlaps.call(d, box, 6)) {
        this.carriedDragons.push(d);
        d.inWater = true;
      }
    for (const b of world.bubbles) if (b.touchable && Entity.prototype.overlaps.call(b, box, 6)) b.pop(world, this.popList);
    if (!this.finished || this.cells.length) {
      for (const m of this.carriedMonsters) {
        m.x = Math.max(32, Math.min(lv.pw - 64, hxp));
        m.y = hyp;
      }
      for (const d of this.carriedDragons) {
        d.x = Math.max(32, Math.min(lv.pw - 64, hxp)) & ~1;
        d.y = hyp;
      }
    }
  }

  private end(world: World): void {
    this.kill();
    for (const m of this.carriedMonsters) m.killedBy(world, this.popList);
    for (const d of this.carriedDragons) {
      d.inWater = false;
      d.y = Math.floor(d.y / 2) * 2;
      d.up = 0;
    }
  }

  draw(g: Gfx): void {
    const c = this.cells;
    for (let i = 0; i < c.length; i++) {
      const [x, y] = c[i];
      const prev = c[i - 1];
      const next = c[i + 1];
      const vertical = (prev && prev[0] === x) || (next && next[0] === x && !prev);
      g.draw(vertical ? 901 : 900, x * CELL, y * CELL);
    }
  }
}

// --- lightning --------------------------------------------------------------

export class LightningBolt extends Entity {
  constructor(
    x: number,
    y: number,
    readonly dir: number,
    readonly popList: PopList,
  ) {
    super();
    this.x = x + 4;
    this.y = y + 4;
    this.w = 24;
    this.h = 24;
  }
  update(world: World): void {
    this.age++;
    this.x += this.dir * 10;
    if (this.x < -32 || this.x > world.level.pw + 32) {
      this.kill();
      return;
    }
    for (const m of world.monsters) if (m.harmful && this.overlaps(m, 0)) m.killedBy(world, this.popList);
    for (const b of world.bubbles) if (b.touchable && b.kind !== 'lightning' && this.overlaps(b, 2)) b.pop(world, this.popList);
  }
  draw(g: Gfx, world: World): void {
    g.draw(488, this.x, this.y, { flipX: this.dir < 0, alpha: world.frame & 2 ? 1 : 0.75 });
  }
}

// --- monster shots ----------------------------------------------------------

export type ShotKind = 'normal' | 'fast' | 'boomerang' | 'down';

export class MonsterShot extends Entity {
  harmful = true;
  private speed: number;
  private decay = -1;
  private returning = false;
  private frames: number[];

  constructor(
    readonly owner: Monster,
    readonly kind: ShotKind,
    world: World,
  ) {
    super();
    const dir = owner.dir;
    this.speed = { normal: 4.5, fast: 10, boomerang: 6, down: 5 }[kind] * dir;
    this.frames =
      kind === 'normal' ? [451] : kind === 'fast' ? range(dir < 0 ? 456 : 460, 4) : kind === 'boomerang' ? range(472, 4) : [476];
    const f = world.gfxFrameSize(this.frames[0]);
    this.w = f.w;
    this.h = f.h;
    this.x = owner.x + (32 - this.w) / 2;
    this.y = owner.y + (32 - this.h) / 2;
    if (kind === 'down') {
      this.y += CELL;
      this.speed = 5;
    } else if (!this.blocked(world)) this.x += CELL * dir;
  }

  private blocked(world: World): boolean {
    const lv = world.level;
    const x0 = this.speed < 0 ? floorDiv(this.x - this.speed - 8, 16) : floorDiv(this.x + this.w + this.speed - 8, 16);
    const y0 = floorDiv(this.y + 8, 16) + 1;
    return lv.wall(x0, y0) || lv.wall(x0 + 1, y0);
  }

  update(world: World): void {
    this.age++;
    const lv = world.level;
    if (this.decay >= 0) {
      if (++this.decay > 12) this.kill();
      return;
    }
    if (this.kind === 'down') {
      this.y += this.speed;
      if (this.y >= lv.ph) this.kill();
      return;
    }
    if (this.returning) {
      this.x -= this.speed;
      if ((this.owner.x - this.x) * this.speed > 0 || this.x < 0 || this.x > lv.pw || this.owner.dead) this.kill();
      return;
    }
    if (this.blocked(world)) {
      if (this.kind === 'boomerang') this.returning = true;
      else if (this.kind === 'normal') {
        this.decay = 0;
        this.harmful = false;
      } else this.kill();
      return;
    }
    this.x += this.speed;
  }

  draw(g: Gfx): void {
    if (this.decay >= 0) {
      g.draw(452 + Math.min(3, floorDiv(this.decay, 3)), this.x, this.y);
      return;
    }
    g.draw(this.frames[floorDiv(this.age, 3) % this.frames.length], this.x, this.y);
  }
}

// --- Baron von Blubba ---------------------------------------------------------

export class Baron extends Entity {
  harmful = true;
  private vx = 0;
  private vy = 0;
  private leaving = false;
  dir = 1;

  constructor(world: World) {
    super();
    this.x = world.level.pw / 2 - 16;
    this.y = -40;
  }

  leave(): void {
    this.leaving = true;
    this.harmful = false;
  }

  update(world: World): void {
    this.age++;
    if (this.leaving) {
      this.y -= 4;
      if (this.y < -48) this.kill();
      return;
    }
    const targets = world.dragons.filter((d) => d.alive);
    const t = targets.length ? targets.reduce((a, b) => (Math.hypot(a.x - this.x, a.y - this.y) < Math.hypot(b.x - this.x, b.y - this.y) ? a : b)) : null;
    const speed = Math.min(2.6, 1.0 + this.age / 1200);
    if (t) {
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      this.vx += ((dx / dist) * speed - this.vx) * 0.04;
      this.vy += ((dy / dist) * speed - this.vy) * 0.04;
      if (Math.abs(dx) > 4) this.dir = dx > 0 ? 1 : -1;
    }
    this.x += this.vx;
    this.y += this.vy;
    for (const d of world.dragons) if (d.vulnerable && this.overlaps(d, 8)) d.die(world);
  }

  draw(g: Gfx, world: World): void {
    const base = this.dir > 0 ? 447 : 443;
    g.draw(base + (floorDiv(world.frame, 6) % 4), this.x, this.y);
  }
}

// --- book stars ---------------------------------------------------------------

export class Star extends Entity {
  private vx: number;
  private vy: number;
  private color: number;
  constructor(
    x: number,
    y: number,
    angle: number,
    readonly popList: PopList,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * 4.5;
    this.vy = Math.sin(angle) * 4.5 - 2;
    this.color = Math.floor(rand() * 6);
  }
  update(world: World): void {
    this.age++;
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.08;
    const lv = world.level;
    if (this.x < 16 || this.x > lv.pw - 48) this.vx = -this.vx;
    if (this.y > lv.ph + 32 || this.age > 240) this.kill();
    for (const m of world.monsters) if (m.harmful && this.overlaps(m, 4)) m.killedBy(world, this.popList);
  }
  draw(g: Gfx): void {
    g.draw(940 + this.color * 2 + (floorDiv(this.age, 4) % 2), this.x, this.y);
  }
}

/** Short-lived explosion sprite (big bubble burst). */
export class Burst extends Entity {
  constructor(
    x: number,
    y: number,
    readonly frames: number[] = [913, 914, 915],
    readonly hold = 4,
  ) {
    super();
    this.x = x;
    this.y = y;
  }
  update(): void {
    if (++this.age >= this.frames.length * this.hold) this.kill();
  }
  draw(g: Gfx): void {
    g.draw(this.frames[Math.min(this.frames.length - 1, floorDiv(this.age, this.hold))], this.x, this.y);
  }
}

/** Fire rain drop for the cross of fire. */
export function randomFireRain(world: World, popList: PopList, n: number): void {
  const lv = world.level;
  for (let i = 0; i < n; i++) {
    const d = new FireDrop(32 + rand() * (lv.pw - 80), -16 - i * 40, popList);
    world.add(d);
  }
}

