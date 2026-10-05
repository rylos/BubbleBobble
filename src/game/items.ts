// Items: flying dead monsters, fruit, power-ups and floating score labels.

import type { Gfx } from '../engine/gfx';
import { CELL, SCORE, TIMING, sec } from './const';
import { Entity, choice, rand, range } from './entity';
import type { Bubble } from './bubble';
import type { Dragon } from './dragon';
import type { Monster } from './monster';
import type { World } from './world';

const FRUIT_CHAIN = range(593, 7); // banana, peach, quince, pastec, wine, ananas, diamond

/** Sprite ids for score labels (per-player colour sheets), mnstrmap.GreenAndBlue.points. */
const POINT_SPRITES: Record<number, number> = {
  100: 529, 150: 530, 200: 531, 250: 532, 300: 533, 350: 534, 500: 535, 550: 536, 600: 537,
  650: 538, 700: 539, 750: 540, 800: 541, 850: 542, 900: 543, 950: 544, 1000: 545, 2000: 546,
  3000: 547, 4000: 548, 5000: 549, 6000: 550, 7000: 551, 8000: 552, 9000: 553, 10000: 20,
  20000: 21, 30000: 22, 40000: 23, 50000: 24, 60000: 25, 70000: 26,
};

export class PointsLabel extends Entity {
  constructor(
    x: number,
    y: number,
    readonly points: number,
    readonly p: number,
  ) {
    super();
    this.x = x;
    this.y = y;
  }
  update(): void {
    this.age++;
    if (this.age < 30) this.y -= 1.5;
    if (this.age > 70) this.kill();
  }
  draw(g: Gfx): void {
    const id = POINT_SPRITES[this.points];
    if (id !== undefined) {
      const f = g.frame(id, this.p);
      g.drawFrame(f, this.x + 16 - f.w / 2, this.y + 8 - f.h / 2);
    } else {
      const colors = ['#8f8', '#8cf', '#f9c', '#fc6'];
      g.text(String(this.points), this.x + 16, this.y + 4, colors[this.p] ?? '#fff', { align: 'center' });
    }
  }
}

/** A monster spinning through the air after being popped; lands as fruit. */
export class DeadMonster extends Entity {
  private dx: number;
  private dy: number;
  private falling = false;
  private frames: number[];

  constructor(
    m: Monster,
    readonly level: number,
    readonly by: Dragon | null,
  ) {
    super();
    this.x = m.x;
    this.y = m.y;
    this.frames = m.deadFrames;
    this.dx = (rand() * 2 - 1) * 5;
    this.dy = -6 * (0.5 + rand());
  }

  update(world: World): void {
    const lv = world.level;
    this.age++;
    if (!this.falling) {
      this.x += this.dx;
      this.y += this.dy;
      this.dy += 0.25;
      if (this.x < 32) {
        this.x = 32;
        this.dx = Math.abs(this.dx);
      } else if (this.x > lv.pw - 64) {
        this.x = lv.pw - 64;
        this.dx = -Math.abs(this.dx);
      }
      if (this.y < -16) {
        this.y = -16;
        this.dy = Math.abs(this.dy) * 0.5;
      }
      if (this.dy > 0 && this.age > 30) {
        this.falling = true;
        this.x = Math.round(this.x / 2) * 2;
        this.y = Math.floor(this.y / 4) * 4;
      }
      return;
    }
    if ((lv.onGround(this.x, this.y) && lv.free(this.x, this.y)) || this.age > sec(4)) {
      this.kill();
      const at = lv.free(this.x, this.y) && lv.onGround(this.x, this.y) ? this : lv.landingSpot(this.x, this.y);
      world.add(new Fruit(at.x, at.y, this.level));
      return;
    }
    this.y = lv.warpY(this.y + 4);
  }

  draw(g: Gfx): void {
    g.draw(this.frames[Math.floor(this.age / 4) % 4], this.x, this.y);
  }
}

/** Base for anything a dragon can pick up. */
export abstract class Item extends Entity {
  pickable = true;
  bubblable = false;
  lifetime = TIMING.fruitLife;
  protected inBubbleOf: Bubble | null = null;
  protected settle = true;

  abstract get points(): number;
  abstract get sprite(): number | string;
  protected sound = 'fruit';

  protected effect(_world: World, _d: Dragon): void {}

  update(world: World): void {
    this.age++;
    if (this.inBubbleOf) return;
    if (this.settle) {
      const lv = world.level;
      if (!lv.onGround(this.x, this.y) || !lv.free(this.x, this.y)) {
        if (this.age > sec(3)) Object.assign(this, lv.landingSpot(this.x, this.y));
        else this.y = lv.warpY((this.y + 4) & ~3);
        return;
      }
    }
    if (this.lifetime > 0 && this.age > this.lifetime) this.kill();
  }

  pickUp(world: World, d: Dragon): void {
    if (this.dead) return;
    this.kill();
    world.sfx(this.sound, this);
    if (this.points) world.givePoints(d.player, this.points, this.x, this.y);
    d.player.stats.items++;
    this.effect(world, d);
  }

  inBubble(b: Bubble): void {
    this.inBubbleOf = b;
    this.pickable = false;
  }

  bubblePopped(world: World, d: Dragon): void {
    this.inBubbleOf = null;
    this.pickable = true;
    world.sfx('yippee', this);
    this.pickUp(world, d);
  }

  drawInBubble(g: Gfx, x: number, y: number, world: World): void {
    const q = ['questionmark1', 'questionmark2', 'questionmark3', 'questionmark4', 'questionmark5'];
    g.draw(q[Math.floor(world.frame / 5) % 5], x + 8, y + 8);
  }

  draw(g: Gfx, world: World): void {
    if (this.inBubbleOf) return;
    const left = this.lifetime > 0 ? this.lifetime - this.age : 999;
    if (left < sec(2) && world.frame & 4) return;
    g.draw(this.sprite, this.x, this.y);
  }
}

export class Fruit extends Item {
  constructor(
    x: number,
    y: number,
    readonly level: number,
  ) {
    super();
    this.x = x;
    this.y = y;
  }
  get points(): number {
    return SCORE.chain[Math.min(this.level, SCORE.chain.length - 1)];
  }
  get sprite(): number {
    return FRUIT_CHAIN[Math.min(this.level, FRUIT_CHAIN.length - 1)];
  }
}

// --- random bonuses -------------------------------------------------------

type BonusEffect = (world: World, d: Dragon, item: Bonus) => void;

interface BonusDef {
  name: string;
  sprite: number | string;
  points: number;
  weight: number;
  effect?: BonusEffect;
  sound?: string;
  bubblable?: boolean;
  /** Text shown when taken. */
  label?: string;
}

const food = (name: string, sprite: number, points: number, weight = 6): BonusDef => ({ name, sprite, points, weight });

export const BONUSES: BonusDef[] = [
  food('cherry', 600, 100),
  food('strawberry', 602, 150),
  food('tomato', 604, 200),
  food('apple', 606, 250),
  food('corn', 607, 300),
  food('radish', 609, 350),
  food('ice cream', 659, 500, 3),
  food('sundae', 660, 1000, 2),
  food('cake', 614, 2000, 1),
  food('emerald', 672, 1000, 1),
  food('sapphire', 681, 2000, 1),
  food('ruby', 682, 3000, 1),
  {
    name: 'shoe', sprite: 631, points: 100, weight: 4, bubblable: true, label: 'SPEED UP',
    effect: (_w, d) => (d.player.caps.speed = Math.min(2, d.player.caps.speed + 0.5)),
  },
  {
    name: 'custard pie', sprite: 666, points: 100, weight: 4, bubblable: true, label: 'RAPID FIRE',
    effect: (_w, d) => (d.player.caps.fireRate = Math.min(3, d.player.caps.fireRate + 0.75)),
  },
  {
    name: 'soft ice', sprite: 663, points: 100, weight: 4, bubblable: true, label: 'LONG SHOT',
    effect: (_w, d) => (d.player.caps.thrust = Math.min(1.6, d.player.caps.thrust + 0.3)),
  },
  {
    name: 'coffee', sprite: 641, points: 750, weight: 2, bubblable: true, label: 'SUPER SPEED',
    effect: (_w, d) => {
      d.player.caps.speed = Math.min(2, d.player.caps.speed + 0.5);
      d.player.caps.fireRate = Math.min(3, d.player.caps.fireRate + 0.5);
    },
  },
  {
    name: 'hamburger', sprite: 675, points: 750, weight: 2, bubblable: true, label: 'FIRE BUBBLES',
    effect: (_w, d) => ((d.special = 'fire'), (d.specialShots = 10)),
  },
  {
    name: 'beer', sprite: 671, points: 750, weight: 2, bubblable: true, label: 'WATER BUBBLES',
    effect: (_w, d) => ((d.special = 'water'), (d.specialShots = 10)),
  },
  {
    name: 'french fries', sprite: 664, points: 750, weight: 2, bubblable: true, label: 'THUNDER BUBBLES',
    effect: (_w, d) => ((d.special = 'lightning'), (d.specialShots = 10)),
  },
  {
    name: 'ring', sprite: 640, points: 4000, weight: 1, bubblable: true, label: 'INVISIBLE',
    effect: (_w, d) => (d.timers.ring = sec(12)),
  },
  {
    name: 'chickpea', sprite: 654, points: 800, weight: 1, bubblable: true, label: 'SHIELD',
    effect: (_w, d) => (d.timers.chickpea = sec(10)),
  },
  {
    name: 'rape', sprite: 652, points: 800, weight: 2, bubblable: true, label: 'AUTO FIRE',
    effect: (_w, d) => (d.timers.autofire = sec(15)),
  },
  {
    name: 'clock', sprite: 636, points: 1000, weight: 2, bubblable: true, label: 'TIME STOP',
    effect: (w) => w.freezeMonsters(sec(8)),
  },
  {
    name: 'heart', sprite: 643, points: 750, weight: 1, bubblable: true, label: 'POWER HEART',
    effect: (w) => w.freezeMonsters(sec(10)),
  },
  {
    name: 'book', sprite: 642, points: 2000, weight: 1, bubblable: true, label: 'BOOK OF STARS',
    effect: (w, d) => w.starBurst(d),
  },
  {
    name: 'bomb', sprite: 670, points: 750, weight: 1, bubblable: true, label: 'BOMB',
    effect: (w, d) => w.bombAll(d),
  },
  {
    name: 'gold cross', sprite: 644, points: 3000, weight: 1, bubblable: true, label: 'CROSS OF THUNDER',
    effect: (w, d) => w.thunderStorm(d),
  },
  {
    name: 'red cross', sprite: 645, points: 3000, weight: 1, bubblable: true, label: 'CROSS OF FIRE',
    effect: (w, d) => w.fireRain(d),
  },
  {
    name: 'blue cross', sprite: 646, points: 3000, weight: 1, bubblable: true, label: 'CROSS OF WATER',
    effect: (w, d) => w.flood(d),
  },
  {
    name: 'red umbrella', sprite: 633, points: 900, weight: 1, bubblable: true, label: 'SKIP 3 ROUNDS',
    effect: (w) => w.skipRounds(3),
  },
  {
    name: 'grey umbrella', sprite: 634, points: 950, weight: 1, bubblable: true, label: 'SKIP 5 ROUNDS',
    effect: (w) => w.skipRounds(5),
  },
  {
    name: 'violet umbrella', sprite: 635, points: 1000, weight: 1, bubblable: true, label: 'SKIP 7 ROUNDS',
    effect: (w) => w.skipRounds(7),
  },
  {
    name: 'red potion', sprite: 637, points: 150, weight: 1, bubblable: true, label: 'POTION',
    effect: (w, d) => w.potion(d, 477),
  },
  {
    name: 'green potion', sprite: 638, points: 350, weight: 1, bubblable: true, label: 'POTION',
    effect: (w, d) => w.potion(d, 478),
  },
  {
    name: 'yellow potion', sprite: 639, points: 550, weight: 1, bubblable: true, label: 'POTION',
    effect: (w, d) => w.potion(d, 481),
  },
  {
    name: 'door', sprite: 139, points: 1000, weight: 1, bubblable: true, label: 'DIAMOND RAIN',
    effect: (w, d) => w.diamondRain(d),
  },
  {
    name: 'extend', sprite: 647, points: 0, weight: 1, bubblable: true, label: 'EXTEND!',
    effect: (w, d) => w.giveAllLetters(d.player),
  },
];

export class Bonus extends Item {
  constructor(
    x: number,
    y: number,
    readonly def: BonusDef,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.bubblable = !!def.bubblable;
    this.lifetime = def.effect ? sec(10) : sec(8);
    if (def.sound) this.sound = def.sound;
    else if (def.effect) this.sound = 'extra';
  }
  get points(): number {
    return this.def.points;
  }
  get sprite(): number | string {
    return this.def.sprite;
  }
  protected effect(world: World, d: Dragon): void {
    if (this.def.label) world.flashText(this.def.label, d.player.index);
    this.def.effect?.(world, d, this);
  }

  static random(): BonusDef {
    const total = BONUSES.reduce((s, b) => s + b.weight, 0);
    let r = rand() * total;
    for (const b of BONUSES) if ((r -= b.weight) < 0) return b;
    return BONUSES[0];
  }
}

/** Point notes that fill the board after a potion. */
export class Note extends Item {
  constructor(
    x: number,
    y: number,
    readonly spriteId: number,
    readonly value: number,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.settle = false;
    this.lifetime = sec(12);
    this.sound = 'fruit';
  }
  get points(): number {
    return this.value;
  }
  get sprite(): number {
    return this.spriteId;
  }
}

/** A diamond or fruit falling from the sky (door bonus, diamond rain). */
export class FallingTreasure extends Item {
  private vy = 0;
  constructor(
    x: number,
    y: number,
    readonly spriteId: number,
    readonly value: number,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.settle = false;
    this.lifetime = sec(9);
  }
  get points(): number {
    return this.value;
  }
  get sprite(): number {
    return this.spriteId;
  }
  update(world: World): void {
    this.age++;
    const lv = world.level;
    if (!lv.onGround(this.x, this.y) || this.y < 0) {
      this.vy = Math.min(4, this.vy + 0.2);
      const ny = this.y + this.vy;
      if (Math.floor(ny / CELL) !== Math.floor(this.y / CELL) && ny > 0 && lv.onGround(this.x, Math.floor(ny / CELL) * CELL)) {
        this.y = Math.floor(ny / CELL) * CELL;
        this.vy = 0;
      } else this.y = lv.warpY(ny);
    }
    if (this.age > this.lifetime) this.kill();
  }
}

export const DIAMONDS = [616, 617, 618, 619];
export const pickDiamond = () => choice(DIAMONDS);
