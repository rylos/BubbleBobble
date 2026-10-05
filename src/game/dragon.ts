// The player's dragon (Bub / Bob). Movement is a port of The Bub's Brothers' Dragon.

import type { Gfx } from '../engine/gfx';
import type { Pad } from '../engine/input';
import { CELL, PLAYER, sec } from './const';
import { Entity, range } from './entity';
import type { World } from './world';
import type { Level } from './level';
import { Bubble, type SpecialKind } from './bubble';

/** Persistent player data across rounds. */
export class Player {
  score = 0;
  lives = PLAYER.startLives;
  letters = [false, false, false, false, false, false];
  nextExtra: number;
  dragon: Dragon | null = null;
  respawnTimer = 0;
  playing = false;
  gameOver = false;
  continueTimer = 0;
  /** Power-ups kept across rounds until death. */
  caps = { speed: 1, fireRate: 1, thrust: 1 };
  stats = { bubbles: 0, kills: 0, jumps: 0, pops: 0, items: 0 };

  constructor(
    readonly index: number,
    readonly pad: Pad,
    firstExtra: number,
  ) {
    this.nextExtra = firstExtra;
  }

  resetCaps(): void {
    this.caps = { speed: 1, fireRate: 1, thrust: 1 };
  }
}

// sprite ids (per-player sheet), see mnstrmap.GreenAndBlue
const POSE = 210; // 13 poses: walk L 0-2, walk R 3-5, shoot L 6/7, shoot R 8/9, dying 10-12
const JUMP = 683; // fall L, fall R, rise L, rise R
const DIE_SEQ = [POSE + 0, POSE + 11, POSE + 12, POSE + 10];
const BLINK = ['shield-left', 'shield-right'];

export class Dragon extends Entity {
  dir: 1 | -1;
  up = 0; // rising speed, 0 when on ground or falling
  private yfp = 0;
  private hfp = 0;
  private walkTime = 0;
  fire = 0;
  shield = PLAYER.spawnShield;
  /** Invulnerable until the first key press (like the original). */
  waitingInput = true;
  dying = 0;
  /** Next shots are special bubbles. */
  special: SpecialKind | null = null;
  specialShots = 0;
  /** Effects from items, frames left. */
  timers = { autofire: 0, ring: 0, chickpea: 0, slippy: 0, hot: 0 };
  vslip = 0;
  private mode = 0;
  /** Carried by a water stream. */
  inWater = false;

  constructor(
    readonly player: Player,
    x: number,
    y: number,
    dir: 1 | -1,
  ) {
    super();
    this.x = x;
    this.y = y;
    this.dir = dir;
  }

  get p(): number {
    return this.player.index;
  }

  get alive(): boolean {
    return this.dying === 0;
  }

  /** Can monsters hurt us right now? */
  get vulnerable(): boolean {
    return this.dying === 0 && this.shield <= 0 && !this.waitingInput && this.timers.chickpea <= 0;
  }

  /** Visible to monsters (Ring makes the dragon invisible). */
  get visible(): boolean {
    return this.dying === 0 && this.timers.ring <= 0;
  }

  die(world: World): void {
    if (!this.vulnerable) return;
    this.dying = 1;
    world.sfx('die', this);
    world.onDragonDeath(this);
  }

  update(world: World): void {
    this.age++;
    const lv = world.level;
    if (this.dying) {
      this.dying++;
      if (this.dying > PLAYER.deathFrames) {
        this.kill();
        world.onDragonGone(this);
      }
      return;
    }
    if (this.inWater) return; // the water stream moves us
    const pad = this.player.pad;
    const t = this.timers;
    for (const k of Object.keys(t) as (keyof typeof t)[]) if (t[k] > 0) t[k]--;

    let wannago = pad.dx;
    const wannajump = pad.held.jump || (world.options.autoJump && pad.held.up);
    let wannafire = pad.pressed('fire') || (t.autofire > 0 && pad.held.fire);
    if (t.hot > 0) {
      if (!wannago) wannago = this.dir;
      wannafire = true;
    }
    if (this.waitingInput && (pad.any() || this.age > sec(4))) this.waitingInput = false;

    if (wannago) this.dir = wannago as 1 | -1;
    if (this.x & 1) this.x += this.dir;

    // horizontal movement in 2 px steps
    if (t.slippy > 0) {
      if (wannago) this.vslip += wannago * 0.05;
      else this.vslip *= 0.95;
      this.vslip = Math.max(-2, Math.min(2, this.vslip));
      wannago = this.vslip < 0 ? -1 : 1;
      this.hfp += Math.abs(this.vslip);
    } else if (wannago) {
      this.hfp += this.player.caps.speed;
    } else {
      this.hfp = 0;
    }
    while (this.hfp > 0) {
      this.hfp -= 1;
      if (wannago && lv.canWalk(this.x, this.y, wannago)) {
        this.x += 2 * wannago;
        this.walkTime = (this.walkTime + 1) % 12;
      } else {
        this.hfp = 0;
        this.vslip = 0;
      }
    }

    // bubbles: touching pops them, standing on top lets us bounce while holding jump
    let onBubble: Bubble | null = null;
    if (!this.waitingInput) {
      for (const b of world.bubbles) {
        if (b.dead || !b.touchable) continue;
        if (b.x < this.x + 31 && this.x + 1 < b.x + 32 && b.y < this.y + 31 && this.y + 1 < b.y + 32) {
          if (b.touchedBy(this, world)) onBubble = b;
        }
      }
    }

    // vertical movement
    if (this.up) {
      this.mode = 9;
      this.up -= PLAYER.gravity * world.gravityScale(this);
      if (this.up < PLAYER.apexSpeed) {
        this.up = 0;
        this.mode = 10;
      } else {
        const ny = this.y + this.yfp - this.up;
        if (ny < CELL && this.y >= 0 && lv.ceilingAt(this.x)) {
          // the top border is solid here: bump the head (only holes lead to the bottom)
          this.y = CELL;
          this.up = 0;
          this.mode = 10;
        } else {
          this.y = Math.trunc(ny);
          this.yfp = ny - this.y;
          this.y = lv.warpY(this.y);
        }
      }
    } else {
      const ground = (wannajump && onBubble) || lv.onGround(this.x, this.y);
      if (ground) {
        if (wannajump) {
          world.sfx('jump', this);
          this.yfp = 0;
          this.up = PLAYER.jumpSpeed;
          this.mode = 9;
          this.player.stats.jumps++;
          if (onBubble) onBubble.bounced = true;
        } else {
          this.mode = Math.floor(this.walkTime / 4);
        }
      } else {
        this.mode = 10;
        let nx = this.x;
        const fall = world.fallSpeed(this);
        const ny = (this.y + fall) & ~1;
        if (nx < 32) nx += 2;
        else if (nx > lv.pw - 64) nx -= 2;
        this.x = nx;
        this.y = lv.warpY(ny);
      }
    }

    // shooting
    if (wannafire && !this.fire) this.shoot(world);
    if (this.fire) {
      if (this.fire <= 5) this.mode = 3;
      else if (this.fire <= 10) this.mode = 4;
      this.fire++;
      if (this.fire >= Math.max(6, Math.round(PLAYER.fireCooldown / this.player.caps.fireRate))) this.fire = 0;
    }

    if (this.shield > 0 && !this.waitingInput) this.shield--;

    // monsters and their shots
    // frozen monsters (clock, heart) die on touch
    for (const m of world.monsters)
      if (m.state === 'frozen' && this.overlaps(m, 6)) m.killedBy(world, { dragon: this, kills: 0 });
    if (this.vulnerable) {
      for (const m of world.monsters) {
        if (m.harmful && this.overlaps(m, 7)) {
          this.die(world);
          return;
        }
      }
      for (const s of world.shots) {
        if (s.harmful && this.overlaps(s, 5)) {
          this.die(world);
          return;
        }
      }
    } else if (this.timers.chickpea > 0) {
      for (const m of world.monsters) if (m.harmful && this.overlaps(m, 7)) m.killedBy(world, null);
    }
    // items
    for (const it of world.items) if (it.pickable && this.overlaps(it, 8)) it.pickUp(world, this);
  }

  private shoot(world: World): void {
    this.fire = 1;
    this.player.stats.bubbles++;
    world.sfx('shoot', this);
    let kind: SpecialKind | null = null;
    if (this.special && this.specialShots > 0) {
      kind = this.special;
      if (--this.specialShots === 0) this.special = null;
    }
    const thrust = PLAYER.shootThrust * this.player.caps.thrust;
    world.add(Bubble.shot(this, this.x + 16 * this.dir, this.y, this.dir, thrust, kind));
  }

  /** Pose sprite for the current mode. */
  private sprite(): number | string {
    const left = this.dir < 0;
    if (this.dying) {
      return DIE_SEQ[Math.floor(this.dying / 4) % 4];
    }
    switch (this.mode) {
      case 0:
      case 1:
      case 2:
        return POSE + (left ? 0 : 3) + this.mode;
      case 3:
        return POSE + (left ? 6 : 8);
      case 4:
        return POSE + (left ? 7 : 9);
      case 9:
        return JUMP + (left ? 2 : 3);
      case 10:
        return JUMP + (left ? 0 : 1);
    }
    return POSE + (left ? 0 : 3);
  }

  draw(g: Gfx, world: World): void {
    const blink = (this.shield > 0 || this.waitingInput) && !this.dying && (world.frame & 4) !== 0;
    if (this.timers.ring > 0 && (world.frame & 2)) return;
    if (blink) {
      g.draw(BLINK[this.dir < 0 ? 0 : 1], this.x, this.y);
      return;
    }
    let y = this.y;
    if (this.dying) y -= Math.sin(Math.min(1, this.dying / 20) * Math.PI) * 6;
    g.draw(this.sprite(), this.x, y, { p: this.p, alpha: this.timers.ring > 0 ? 0.5 : undefined });
    if (this.timers.chickpea > 0) g.draw(`glasses:${this.dir}`, this.x, this.y + 4);
  }

  /** Drawn inside a travel bubble during round transitions. */
  drawTravelling(g: Gfx, x: number, y: number, t: number): void {
    g.draw(range(693, 3)[Math.floor(t / 8) % 3], x, y, { p: this.p });
    g.draw(190, x, y, { p: this.p, alpha: 0.5 });
  }

  /** Is the dragon standing with its feet at a cell boundary on ground? */
  onGround(world: World): boolean {
    return world.level.onGround(this.x, this.y);
  }

  static spawnPos(lv: Level, index: number): { x: number; y: number; dir: 1 | -1 } {
    const y = lv.ph - 3 * CELL;
    const left = index % 2 === 0;
    const x0 = left ? 3 * CELL : lv.pw - 5 * CELL;
    for (const dx of [0, 4, 8, 12, 16, -4, -8, 24, 32]) {
      const x = x0 + (left ? dx : -dx);
      if (lv.free(x, y) && lv.onGround(x, y)) return { x, y, dir: left ? 1 : -1 };
    }
    return { x: x0, y, dir: left ? 1 : -1 };
  }
}
