// Bubbles: shot by dragons, floating on the level winds, popped in chains.
// Port of bubbles.py (Bubble, DragonBubble, PlainBubble, special bubbles).

import type { Gfx } from '../engine/gfx';
import { BUBBLE, CELL, HALF, SCORE } from './const';
import { Entity, choice, randInt, range } from './entity';
import { WIND } from './level';
import type { Dragon } from './dragon';
import type { Monster } from './monster';
import type { World } from './world';
import type { Item } from './items';
import { FireDrop, LightningBolt, WaterStream } from './specials';

export type SpecialKind = 'fire' | 'water' | 'lightning';
export type BubbleKind = 'player' | 'plain' | SpecialKind | 'letter';

/** Shared by every bubble popped in one chain: counts kills for the fruit combo. */
export interface PopList {
  dragon: Dragon | null;
  kills: number;
}

const EXPLODE = range(131, 5);
const WHITE = [164, 165, 164, 163];
const PINK = [172, 173, 172, 171];
const RED = [156, 157, 156, 155];
const LETTERS = [128, 136, 144, 152, 160, 168]; // E X T E N D, 3 frames each
const SPECIAL_BASE: Record<SpecialKind, number> = { fire: 176, lightning: 179, water: 182 };

export class Bubble extends Entity {
  kind: BubbleKind = 'player';
  p = 0; // player colour
  letter = 0;
  touchable = true;
  monster: Monster | null = null;
  item: Item | null = null;
  /** Wraps vertically instead of leaving the screen. */
  warp = false;
  bounced = false;

  private state: 'shot' | 'float' | 'red' | 'pop' = 'float';
  private hspeed = 0;
  private nx = 0;
  private stop = 0;
  private dx = 0;
  private dy = -1;
  private timeout: number | null = BUBBLE.lifetime;
  private redTime = 0;
  private popTime = 0;
  private pause = 0;
  /** Obstacles reported by dragons touching us this frame. */
  private obstacle: [number, number][] = [];
  private popList: PopList | null = null;
  private chainPending = false;
  owner: Dragon | null = null;
  private special: SpecialKind | null = null;

  static shot(d: Dragon, x: number, y: number, dir: number, thrust: number, special: SpecialKind | null): Bubble {
    const b = new Bubble();
    b.x = x;
    b.y = y;
    b.nx = x;
    b.p = d.p;
    b.owner = d;
    b.state = 'shot';
    b.hspeed = dir * thrust;
    b.special = special;
    return b;
  }

  static floating(kind: BubbleKind, x: number, y: number, dx: number, dy: number, p = 0): Bubble {
    const b = new Bubble();
    b.kind = kind;
    b.x = x;
    b.y = y;
    b.dx = dx;
    b.dy = dy;
    b.p = p;
    b.timeout = kind === 'plain' ? BUBBLE.plainLifetime : kind === 'player' ? BUBBLE.lifetime : null;
    if (kind === 'letter') b.letter = randInt(6);
    return b;
  }

  update(world: World): void {
    this.age++;
    switch (this.state) {
      case 'shot':
        this.updateShot(world);
        break;
      case 'pop':
        if (this.chainPending) {
          this.chainPending = false;
          for (const b of world.bubbles)
            if (b !== this && !b.dead && b.touchable && this.overlaps(b, 0)) b.pop(world, this.popList);
        }
        if (++this.popTime >= EXPLODE.length * 2) this.kill();
        return;
      case 'red':
        if (++this.redTime >= 260) {
          this.pop(world, null);
          return;
        }
        this.float(world);
        break;
      default:
        if (this.timeout !== null && --this.timeout <= 0) {
          this.state = 'red';
          this.redTime = 0;
        }
        this.float(world);
    }
    this.obstacle.length = 0;
  }

  private updateShot(world: World): void {
    const lv = world.level;
    if (Math.abs(this.hspeed) >= 4) {
      // capture the first monster we touch
      const touched = world.monsters.filter((m) => m.capturable && this.overlaps(m, 9));
      if (touched.length) {
        const m = choice(touched);
        m.capture(this, world);
        this.monster = m;
        this.warp = true;
        this.timeout = BUBBLE.captureLifetime;
        this.startFloat();
        world.sfx('capture', this);
        return;
      }
      this.nx += this.hspeed;
      this.hspeed *= 0.965;
      const xc = Math.floor((this.nx - 3.8) / CELL) + 1;
      const yc = Math.floor((this.y + HALF) / CELL);
      if (lv.wall(xc, yc) && lv.wall(xc, yc + 1)) this.stop++;
      if (this.stop <= 1) this.x = Math.round(this.nx);
      return;
    }
    // end of throw: a special shot becomes its own kind of bubble
    if (this.special) {
      this.kind = this.special;
      this.timeout = BUBBLE.lifetime;
    } else {
      // swallow a nearby item
      const it = world.items.find((i) => i.bubblable && this.overlaps(i, 12));
      if (it) {
        this.item = it;
        it.inBubble(this);
      }
    }
    this.startFloat();
  }

  private startFloat(): void {
    this.state = 'float';
    this.dx = 0;
    this.dy = -1;
    this.age = 0;
  }

  /** Called by a dragon whose 30x30 box overlaps us. Returns true if the dragon stands on top. */
  touchedBy(d: Dragon, world: World): boolean {
    if (this.state === 'shot' && this.age < 6) return false;
    const o: [number, number][] = [];
    if (Math.abs(this.x - d.x) >= 25) o.push(this.x < d.x ? [1, 0] : [-1, 0]);
    if (Math.abs(this.y - d.y) >= 25) o.push(this.y < d.y ? [0, 1] : [0, -1]);
    if (o.length) {
      this.obstacle.push(...o);
      return o.length === 1 && o[0][0] === 0 && o[0][1] === -1;
    }
    if (this.state === 'shot') return false;
    this.pop(world, { dragon: d, kills: 0 });
    return false;
  }

  private float(world: World): void {
    const lv = world.level;
    if (this.pause > 0) {
      this.pause--;
      return;
    }
    // crowding: wait a little when another bubble is just ahead
    if (this.age % 2 === 0 && (this.dx || this.dy)) {
      const margin = 13 + (this.age & 6);
      for (const b of world.bubbles) {
        if (b === this || b.dead || b.state === 'shot' || b.state === 'pop') continue;
        if (!this.overlaps(b, margin)) continue;
        if ((b.x - this.x) * this.dx > 0 || (b.y - this.y) * this.dy > 0) {
          this.pause = 3 + (this.age & 7);
          return;
        }
      }
    }
    const blocked = this.obstacle.some(([ox, oy]) => ox === this.dx && oy === this.dy);
    if (!blocked) {
      if (this.dx === 0 && this.dy === 0) {
        if (this.obstacle.length === 1) {
          this.x -= this.obstacle[0][0];
          this.y -= this.obstacle[0][1];
        }
      } else {
        this.x += this.dx * BUBBLE.floatSpeed;
        this.y += this.dy * BUBBLE.floatSpeed;
      }
      if (this.y < -32 || this.y >= lv.ph) {
        if (!this.warp) {
          this.releaseContents(world);
          this.kill();
          return;
        }
        this.y = lv.warpY(this.y);
      }
      const w = lv.wind(this.x, this.y);
      if (w !== ' ') [this.dx, this.dy] = WIND[w];
    }
    if (this.monster) {
      this.monster.x = this.x;
      this.monster.y = this.y;
    }
  }

  private releaseContents(world: World): void {
    if (this.monster) {
      this.monster.escape(world, this);
      this.monster = null;
    }
    if (this.item) {
      this.item.kill();
      this.item = null;
    }
  }

  pop(world: World, popList: PopList | null): void {
    if (!this.touchable || this.state === 'pop') return;
    this.touchable = false;
    this.state = 'pop';
    this.popTime = 0;
    this.popList = popList;
    world.sfx('pop', this);
    const d = popList?.dragon ?? null;
    if (d) {
      d.player.stats.pops++;
      world.givePoints(d.player, this.kind === 'letter' ? SCORE.letter : SCORE.bubblePop);
      this.chainPending = true;
    }
    if (this.monster) {
      const m = this.monster;
      this.monster = null;
      if (popList) m.killedBy(world, popList);
      else m.escape(world, this);
    }
    if (this.item) {
      const it = this.item;
      this.item = null;
      if (d) it.bubblePopped(world, d);
      else it.kill();
    }
    if (!d) return;
    switch (this.kind) {
      case 'letter':
        world.collectLetter(d.player, this.letter, this);
        break;
      case 'fire':
        world.add(new FireDrop(this.x + 8, this.y + 8, popList!));
        break;
      case 'water':
        world.add(new WaterStream(world, this.x, this.y, popList!));
        world.sfx('water', this);
        break;
      case 'lightning':
        world.add(new LightningBolt(this.x, this.y, -d.dir, popList!));
        world.sfx('lightning', this);
        break;
    }
  }

  /** Bubble images. */
  private sprite(): number | string {
    const t = this.age;
    if (this.state === 'pop') return EXPLODE[Math.min(EXPLODE.length - 1, Math.floor(this.popTime / 2))];
    if (this.state === 'red') {
      const r = this.redTime;
      if (r < 60) return WHITE[Math.floor(r / 5) % 4];
      if (r < 140) return PINK[Math.floor((r - 60) / 5) % 4];
      if (r < 220) return RED[Math.floor((r - 140) / 5) % 4];
      return (r >> 1) & 1 ? PINK[1] : RED[1];
    }
    switch (this.kind) {
      case 'letter':
        return LETTERS[this.letter] + (Math.floor(t / 6) % 3);
      case 'fire':
      case 'water':
      case 'lightning':
        return SPECIAL_BASE[this.kind] + [1, 2, 1, 0][Math.floor(t / 6) % 4];
    }
    if (this.state === 'shot') {
      const grow = [192, 193, 194, 190];
      return grow[Math.min(3, Math.floor(t / 3))];
    }
    return 188 + [1, 2, 1, 0][Math.floor(t / 8) % 4];
  }

  draw(g: Gfx, world: World): void {
    const id = this.sprite();
    const p = typeof id === 'number' && id >= 176 && id < 200 ? this.p : 0;
    const plain = this.kind === 'player' || this.kind === 'plain';
    g.draw(id, this.x, this.y, { p, alpha: this.state !== 'pop' && plain ? 0.85 : undefined });
    if (this.state === 'pop') return;
    // the captured monster (shrunk "jailed" frames) is drawn over its bubble, like the original
    if (this.monster) this.monster.drawJailed(g, this.x, this.y, world);
    if (this.item) this.item.drawInBubble(g, this.x, this.y, world);
  }
}

/** Random bubble spawner for boards with holes and special flags (bubbles.py newbubble). */
export function spawnAmbientBubble(world: World): void {
  const lv = world.level;
  const f = lv.def.flags;
  const classes: BubbleKind[] = ['plain', 'plain', 'plain', 'plain', 'plain', 'plain', 'plain'];
  for (const k of ['fire', 'water', 'lightning'] as const) if (f[k]) classes.push(k, k, k, k);
  if (f.letter) classes.push('letter', 'letter');
  const kind = choice(classes);
  if (kind === 'plain' && !lv.def.holes) return;
  const limit = kind === 'plain' ? 6 : kind === 'letter' ? 2 : 4;
  if (world.bubbles.filter((b) => b.kind === kind).length >= limit) return;
  const top = f.top;
  // find two adjacent holes in the entry row
  const row = top ? 0 : lv.h - 1;
  const holes: number[] = [];
  for (let x = 2; x < lv.w - 3; x++) if (!lv.wall(x, row) && !lv.wall(x + 1, row)) holes.push(x);
  const cx = holes.length ? choice(holes) : 2 + randInt(lv.w - 5);
  const y = top ? -32 : lv.ph;
  const b = Bubble.floating(kind, cx * CELL, y, 0, top ? 1 : -1, world.randomPlayerColor());
  b.warp = false;
  world.add(b);
}
