// The running game: one round at a time, players, every sprite list and the
// arcade rules (hurry up, Baron von Blubba, EXTEND, fruit chains, extra lives).

import type { Audio } from '../engine/audio';
import type { Gfx } from '../engine/gfx';
import { SCREEN_W } from '../engine/gfx';
import { CELL, FIELD_Y, PLAYER, SCORE, TIMING, sec } from './const';
import { Entity, choice, rand, randInt } from './entity';
import { Level, type LevelSet } from './level';
import { Bubble, spawnAmbientBubble, type PopList } from './bubble';
import { Dragon, Player } from './dragon';
import { Monster } from './monster';
import { Bonus, DeadMonster, FallingTreasure, Item, Note, PointsLabel, pickDiamond } from './items';
import { Baron, Burst, FireDrop, LightningBolt, MonsterShot, Star, WaterStream, randomFireRain } from './specials';
import type { Input } from '../engine/input';
import { buildBossArena, setupBossRound, type BossHandle } from './boss';

export interface Options {
  autoJump: boolean; // up also jumps
  startLevel: number;
}

type RoundState = 'scroll' | 'ready' | 'play' | 'clear' | 'extend' | 'done';

export interface WorldEvents {
  gameOver(world: World): void;
  allClear(world: World): void;
}

const LETTER_IDS = [128, 136, 144, 152, 160, 168];

export class LevelImages {
  private cache = new Map<number, Promise<HTMLImageElement>>();
  constructor(
    private gfx: Gfx,
    readonly set: LevelSet,
  ) {}
  get(index: number): Promise<HTMLImageElement> {
    let p = this.cache.get(index);
    if (!p) {
      p = this.gfx.loadImage(`levels/${this.set.id}/${String(index + 1).padStart(3, '0')}.png`);
      this.cache.set(index, p);
    }
    return p;
  }
}

export class World {
  level!: Level;
  levelIndex = 0;
  levelImage: HTMLImageElement | null = null;
  private nextImage: HTMLImageElement | null = null;
  private nextLevel: Level | null = null;

  players: Player[] = [];
  dragons: Dragon[] = [];
  bubbles: Bubble[] = [];
  monsters: Monster[] = [];
  items: Item[] = [];
  shots: MonsterShot[] = [];
  fx: Entity[] = [];
  baron: Baron | null = null;
  /** Final round boss (set up by boss.ts). */
  boss: BossHandle | null = null;

  frame = 0;
  state: RoundState = 'scroll';
  stateTime = 0;
  roundTime = 0;
  hurried = false;
  private hurrySign = 0;
  monsterSpeedScale = 1;
  private freezeTimer = 0;
  private bonusTimer = 0;
  private clearTimer = 0;
  private skipTo = 0;
  private scrollY = 0;
  private travel: { d: Player; fx: number; fy: number; tx: number; ty: number }[] = [];
  shake = 0;
  private flash: { text: string; color: string; time: number } | null = null;
  highScore: number;
  paused = false;
  private pendingKills: { m: Monster; list: PopList; at: number }[] = [];

  constructor(
    readonly gfx: Gfx,
    readonly audio: Audio,
    readonly input: Input,
    readonly set: LevelSet,
    readonly images: LevelImages,
    readonly options: Options,
    readonly events: WorldEvents,
    highScore: number,
  ) {
    this.highScore = highScore;
    if (import.meta.env.DEV) Object.assign(window, { bbx: { Bubble, Monster, Bonus, Dragon, Baron, BONUSES: Bonus } });
  }

  // --- setup ----------------------------------------------------------------

  async start(players: number): Promise<void> {
    for (let i = 0; i < players; i++) this.join(i, false);
    this.levelIndex = this.options.startLevel;
    this.level = new Level(this.set.levels[this.levelIndex], this.levelIndex);
    this.levelImage = await this.images.get(this.levelIndex);
    this.preload(this.levelIndex + 1);
    this.beginRound(true);
  }

  /** Warm the image cache for a regular (non-boss) round. */
  private preload(index: number): void {
    if (index < this.set.levels.length - 1) void this.images.get(index);
  }

  join(index: number, midGame = true): void {
    let p = this.players.find((q) => q.index === index);
    if (!p) {
      p = new Player(index, this.input.pads[index], SCORE.extraLifeFirst);
      this.players.push(p);
      this.players.sort((a, b) => a.index - b.index);
    }
    p.playing = true;
    p.gameOver = false;
    p.lives = PLAYER.startLives;
    p.continueTimer = 0;
    p.letters.fill(false);
    p.resetCaps();
    if (midGame) {
      this.sfx('letsgo');
      p.respawnTimer = 1;
    }
  }

  get activePlayers(): Player[] {
    return this.players.filter((p) => p.playing && !p.gameOver);
  }

  randomPlayerColor(): number {
    const a = this.activePlayers;
    return a.length ? choice(a).index : 0;
  }

  // --- round flow -----------------------------------------------------------

  private beginRound(first: boolean): void {
    this.bubbles = [];
    this.items = [];
    this.shots = [];
    this.fx = [];
    this.monsters = [];
    this.baron = null;
    this.boss = null;
    this.pendingKills = [];
    this.roundTime = 0;
    this.hurried = false;
    this.freezeTimer = 0;
    this.bonusTimer = sec(8 + rand() * 6);
    this.audio.setMusicRate(1);
    this.setState('ready');
    // monsters drop in from the top
    this.level.def.monsters.forEach((m, i) => {
      const mon = new Monster(m.type, m.x * CELL, m.y * CELL, m.dir, i * 6);
      mon.startEntering();
      this.monsters.push(mon);
    });
    // dragons
    for (const p of this.players) {
      if (!p.playing || p.gameOver) continue;
      if (first || !p.dragon) this.spawnDragon(p);
      else {
        const pos = Dragon.spawnPos(this.level, p.index);
        const d = p.dragon;
        d.x = pos.x;
        d.y = pos.y;
        d.dir = pos.dir;
        d.up = 0;
        d.shield = PLAYER.spawnShield;
      }
    }
    if (this.isBossRound) setupBossRound(this);
    else this.music();
    if (first) this.sfx('letsgo');
  }

  get isBossRound(): boolean {
    return this.levelIndex === this.set.levels.length - 1;
  }

  private music(): void {
    const n = this.levelIndex + 1;
    if (n === this.set.levels.length) this.audio.playMusic('potion');
    else if (this.levelIndex % 20 >= 10 && this.audio.hasMusic('main2')) this.audio.playMusic('main2');
    else this.audio.playMusic('main');
  }

  private spawnDragon(p: Player): void {
    const pos = Dragon.spawnPos(this.level, p.index);
    const d = new Dragon(p, pos.x, pos.y, pos.dir);
    p.dragon = d;
    this.dragons.push(d);
  }

  private setState(s: RoundState): void {
    this.state = s;
    this.stateTime = 0;
  }

  /** Called when the last monster is gone. */
  private roundClear(): void {
    this.setState('clear');
    this.clearTimer = 0;
    this.baron?.leave();
    this.audio.setMusicRate(1);
    for (const s of this.shots) s.kill();
  }

  private async nextRound(): Promise<void> {
    let next = this.levelIndex + 1 + this.skipTo;
    this.skipTo = 0;
    if (next >= this.set.levels.length) next = this.set.levels.length - 1;
    if (this.levelIndex === this.set.levels.length - 1) {
      this.setState('done');
      this.events.allClear(this);
      return;
    }
    this.setState('done');
    if (next === this.set.levels.length - 1) {
      const arena = await buildBossArena(this, next);
      this.nextImage = arena.image;
      this.nextLevel = arena.level;
    } else {
      this.nextImage = await this.images.get(next);
      this.nextLevel = new Level(this.set.levels[next], next);
      this.preload(next + 1);
    }
    // dragons ride bubbles to their new start positions
    this.travel = [];
    const lv = this.nextLevel;
    for (const p of this.activePlayers) {
      const d = p.dragon;
      const from = d && d.alive ? { x: d.x, y: d.y } : { x: lv.pw / 2 - 16, y: lv.ph / 2 };
      const to = Dragon.spawnPos(lv, p.index);
      this.travel.push({ d: p, fx: from.x, fy: from.y, tx: to.x, ty: to.y + lv.ph });
    }
    this.dragons = this.dragons.filter((d) => d.alive);
    this.scrollY = 0;
    this.setState('scroll');
  }

  // --- per-frame update ---------------------------------------------------

  update(): void {
    if (this.paused) return;
    this.frame++;
    this.stateTime++;
    if (this.shake > 0) this.shake--;
    if (this.hurrySign > 0) this.hurrySign--;
    if (this.flash && --this.flash.time <= 0) this.flash = null;

    this.handleJoins();

    if (this.state === 'scroll') {
      this.scrollY = Math.min(this.level.ph, this.scrollY + TIMING.scrollSpeed);
      if (this.scrollY >= this.level.ph) {
        this.levelIndex = this.nextLevel!.index;
        this.level = this.nextLevel!;
        this.levelImage = this.nextImage;
        this.nextLevel = null;
        this.beginRound(false);
      }
      return;
    }
    if (this.state === 'done') return;

    this.updatePlayers();

    for (const d of this.dragons) d.update(this);
    for (const b of this.bubbles) b.update(this);
    if (this.freezeTimer > 0) {
      if (--this.freezeTimer === 0) for (const m of this.monsters) if (m.state === 'frozen') m.escape(this, null);
    }
    for (const m of this.monsters) m.update(this);
    for (const i of this.items) i.update(this);
    for (const s of this.shots) s.update(this);
    for (const f of this.fx) f.update(this);
    this.baron?.update(this);
    if (this.pendingKills.length) {
      for (const k of this.pendingKills) if (k.at <= this.frame) k.m.killedBy(this, k.list);
      this.pendingKills = this.pendingKills.filter((k) => k.at > this.frame);
    }
    this.sweep();

    if (this.state === 'ready' && this.monsters.every((m) => m.state !== 'enter')) this.setState('play');
    if (this.state === 'play') this.updatePlay();
    else if (this.state === 'clear') this.updateClear();
  }

  private handleJoins(): void {
    for (let i = 0; i < 2; i++) {
      const pad = this.input.pads[i];
      if (!pad.pressed('start')) continue;
      const p = this.players.find((q) => q.index === i);
      if (!p || !p.playing || (p.gameOver && p.continueTimer > 0)) {
        if (p?.gameOver) p.score = 0;
        this.join(i);
      }
    }
  }

  private updatePlayers(): void {
    for (const p of this.players) {
      if (p.gameOver && p.continueTimer > 0) {
        p.continueTimer--;
        if (p.continueTimer === 0) {
          p.playing = false;
          if (!this.activePlayers.length) this.events.gameOver(this);
        }
      }
      if (!p.playing || p.gameOver || p.dragon) continue;
      if (p.respawnTimer > 0 && --p.respawnTimer === 0 && this.state !== 'clear') this.spawnDragon(p);
      else if (p.respawnTimer === 0 && this.state !== 'clear') this.spawnDragon(p);
    }
  }

  private updatePlay(): void {
    if (this.dragons.length) this.roundTime++;
    if (this.boss) {
      this.boss.update(this);
      if (this.boss.defeated && !this.monsters.length) this.roundClear();
      return;
    }
    if (!this.monsters.length) {
      this.roundClear();
      return;
    }
    // hurry up!
    if (this.roundTime === TIMING.hurry) {
      this.hurried = true;
      this.hurrySign = sec(2.5);
      this.sfx('hurry');
      this.audio.setMusicRate(1.22);
      for (const m of this.monsters) m.angry = true;
    }
    if (this.roundTime === TIMING.baron && !this.baron) {
      this.baron = new Baron(this);
      this.sfx('hell');
    }
    // ambient bubbles from the holes, special bubbles on flagged boards
    if (rand() < 0.022) spawnAmbientBubble(this);
    // random bonus items
    if (--this.bonusTimer <= 0) {
      this.bonusTimer = sec(14 + rand() * 12);
      if (!this.items.some((i) => i instanceof Bonus)) this.spawnBonus();
    }
  }

  private updateClear(): void {
    this.clearTimer++;
    // pop the remaining bubbles one by one
    if (this.clearTimer % 3 === 0) {
      const b = this.bubbles.find((x) => x.touchable && !x.monster);
      if (b) b.pop(this, null);
    }
    const busy = this.fx.some((f) => f instanceof DeadMonster) || this.items.some((i) => i instanceof FallingTreasure);
    if (busy) this.clearTimer = Math.min(this.clearTimer, 30);
    if (this.clearTimer > TIMING.clearWait || (this.clearTimer > sec(1.5) && !this.items.length && !busy)) {
      void this.nextRound();
    }
  }

  spawnBonus(): void {
    const avoid = this.dragons.map((d) => ({ x: d.x, y: d.y }));
    const pos = this.level.randomGround(rand, avoid);
    if (!pos) return;
    const def = Bonus.random();
    this.add(new Bonus(pos.x, pos.y, def));
  }

  /** Remove dead sprites. */
  private sweep(): void {
    const alive = <T extends Entity>(a: T[]) => (a.some((e) => e.dead) ? a.filter((e) => !e.dead) : a);
    this.dragons = alive(this.dragons);
    this.bubbles = alive(this.bubbles);
    this.monsters = alive(this.monsters);
    this.items = alive(this.items);
    this.shots = alive(this.shots);
    this.fx = alive(this.fx);
    if (this.baron?.dead) this.baron = null;
  }

  add(e: Entity): void {
    if (e instanceof Bubble) this.bubbles.push(e);
    else if (e instanceof Monster) this.monsters.push(e);
    else if (e instanceof Item) this.items.push(e);
    else if (e instanceof MonsterShot) this.shots.push(e);
    else if (e instanceof Dragon) this.dragons.push(e);
    else this.fx.push(e);
  }

  // --- callbacks from sprites -----------------------------------------------

  sfx(name: string, at?: { x: number }): void {
    const pan = at ? (at.x - this.level.pw / 2) / (this.level.pw / 2) : 0;
    this.audio.sfx(name, pan);
  }

  givePoints(p: Player, points: number, x?: number, y?: number): void {
    if (!points) return;
    p.score += points;
    if (x !== undefined && y !== undefined) this.add(new PointsLabel(x, y, points, p.index));
    while (p.score >= p.nextExtra) {
      p.lives++;
      p.nextExtra += SCORE.extraLifeEvery;
      this.sfx('extralife');
      this.flashText('EXTRA LIFE!', p.index);
    }
    if (p.score > this.highScore) this.highScore = p.score;
  }

  gfxFrameSize(id: number): { w: number; h: number } {
    const f = this.gfx.frame(id);
    return { w: f.w, h: f.h };
  }

  gravityScale(_d: Dragon): number {
    return 1;
  }
  fallSpeed(_d: Dragon): number {
    return PLAYER.fallSpeed;
  }

  monsterShoot(m: Monster): void {
    if (!m.def.shot) return;
    this.add(new MonsterShot(m, m.def.shot, this));
  }

  onMonsterCaptured(_m: Monster): void {}

  onMonsterKilled(m: Monster, list: PopList): void {
    if (list.dragon) list.dragon.player.stats.kills++;
    this.sfx('kill', m);
    // a big chain earns an EXTEND letter bubble, like the arcade
    if (list.kills === 3 && this.level.def.flags.letter === false) {
      const b = Bubble.floating('letter', this.level.pw / 2 - 16, this.level.ph, 0, -1);
      b.warp = true;
      this.add(b);
    }
  }

  onDragonDeath(d: Dragon): void {
    d.player.resetCaps();
    d.special = null;
    // Baron leaves and the hurry timer restarts
    if (this.baron) {
      this.baron.leave();
    }
    this.roundTime = Math.min(this.roundTime, sec(10));
    this.hurried = false;
    this.audio.setMusicRate(1);
  }

  onDragonGone(d: Dragon): void {
    const p = d.player;
    if (p.dragon === d) p.dragon = null;
    p.lives--;
    if (p.lives <= 0) {
      p.gameOver = true;
      p.continueTimer = sec(10);
      p.letters.fill(false);
      if (!this.players.some((q) => q.playing && !q.gameOver)) this.audio.playMusic('potion', false);
    } else {
      p.respawnTimer = PLAYER.respawnDelay;
    }
  }

  collectLetter(p: Player, letter: number, at: Entity): void {
    if (!p.letters[letter]) {
      p.letters[letter] = true;
      this.sfx('letter', at);
    }
    if (p.letters.every(Boolean)) this.extend(p);
  }

  giveAllLetters(p: Player): void {
    p.letters.fill(true);
    this.extend(p);
  }

  private extend(p: Player): void {
    p.letters.fill(false);
    p.lives++;
    this.sfx('extralife');
    this.audio.playMusic('extend', false);
    this.flashText('EXTEND!', p.index, sec(3));
    this.givePoints(p, SCORE.extendBonus);
    const list: PopList = { dragon: p.dragon, kills: 0 };
    for (const m of [...this.monsters]) m.killedBy(this, list);
    for (let i = 0; i < 3; i++) this.add(new Burst(64 + rand() * (this.level.pw - 160), 48 + rand() * 200, [952, 953, 954, 955, 956, 913, 914, 915]));
    this.roundClear();
  }

  // --- bonus effects ----------------------------------------------------------

  flashText(text: string, player = 0, time = sec(2)): void {
    const colors = ['#7f7', '#7cf', '#f8c', '#fc6'];
    this.flash = { text, color: colors[player] ?? '#fff', time };
  }

  freezeMonsters(frames: number): void {
    this.freezeTimer = frames;
    for (const m of this.monsters) m.freeze();
  }

  private killAll(d: Dragon, delay = 0): void {
    const list: PopList = { dragon: d, kills: 0 };
    const ms = [...this.monsters].filter((m) => m.state !== 'enter');
    ms.forEach((m, i) => this.pendingKills.push({ m, list, at: this.frame + Math.round((delay * i) / 16) }));
  }

  starBurst(d: Dragon): void {
    const list: PopList = { dragon: d, kills: 0 };
    const cx = this.level.pw / 2 - 16;
    for (let i = 0; i < 10; i++) this.add(new Star(cx, 40, (i / 10) * Math.PI * 2, list));
    this.sfx('shh');
  }

  bombAll(d: Dragon): void {
    this.shake = 40;
    this.sfx('shh');
    for (let i = 0; i < 6; i++) this.add(new Burst(64 + rand() * (this.level.pw - 160), 32 + rand() * (this.level.ph - 96)));
    this.killAll(d, 40);
  }

  thunderStorm(d: Dragon): void {
    const list: PopList = { dragon: d, kills: 0 };
    for (let i = 0; i < 12; i++) {
      const y = 16 + (i % 12) * 32;
      this.add(new LightningBolt(i % 2 ? -32 : this.level.pw, y, i % 2 ? 1 : -1, list));
    }
    this.sfx('lightning');
    this.shake = 20;
  }

  fireRain(d: Dragon): void {
    randomFireRain(this, { dragon: d, kills: 0 }, 14);
  }

  flood(d: Dragon): void {
    const list: PopList = { dragon: d, kills: 0 };
    for (let x = 4; x < this.level.w - 4; x += 6) this.add(new WaterStream(this, x * CELL, 0, list));
    this.sfx('water');
  }

  skipRounds(n: number): void {
    this.skipTo = Math.min(n, this.set.levels.length - 2 - this.levelIndex);
    if (this.skipTo < 0) this.skipTo = 0;
    for (const m of [...this.monsters]) m.kill();
    this.monsters = [];
    this.roundClear();
  }

  potion(d: Dragon, note: number): void {
    const list: PopList = { dragon: d, kills: 0 };
    for (const m of [...this.monsters]) m.killedBy(this, list);
    this.audio.playMusic('potion', false);
    const values: Record<number, number> = { 477: 350, 478: 1000, 481: 2000 };
    for (let cy = 2; cy < this.level.h - 3; cy += 2)
      for (let cx = 2; cx < this.level.w - 4; cx += 2)
        if (this.level.free(cx * CELL, cy * CELL)) this.add(new Note(cx * CELL, cy * CELL, note, values[note] ?? 500));
  }

  diamondRain(_d: Dragon): void {
    for (let i = 0; i < 10; i++) {
      const x = 32 + randInt(this.level.w - 6) * CELL;
      this.add(new FallingTreasure(x, -32 - i * 24, pickDiamond(), 8000));
    }
    this.sfx('extra');
  }

  // --- drawing --------------------------------------------------------------

  draw(g: Gfx): void {
    const ctx = g.ctx;
    ctx.save();
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = Math.round((rand() - 0.5) * Math.min(8, this.shake));
      sy = Math.round((rand() - 0.5) * Math.min(8, this.shake));
    }
    ctx.beginPath();
    ctx.rect(0, FIELD_Y, SCREEN_W, this.level.ph);
    ctx.clip();
    ctx.translate(sx, FIELD_Y + sy);

    if (this.state === 'scroll') {
      this.drawScroll(g);
      ctx.restore();
      return;
    }
    if (this.levelImage) ctx.drawImage(this.levelImage, 0, 0);
    this.drawRoundNumber(g);

    const wrapped = (e: Entity) => {
      e.draw(g, this);
      if (e.y > this.level.ph - e.h) {
        ctx.save();
        ctx.translate(0, -this.level.wrapH);
        e.draw(g, this);
        ctx.restore();
      }
    };
    for (const i of this.items) wrapped(i);
    for (const m of this.monsters) wrapped(m);
    for (const f of this.fx as Entity[]) if (f instanceof DeadMonster || f instanceof FireDrop) (f as Entity).draw(g, this);
    for (const d of this.dragons) wrapped(d);
    for (const b of this.bubbles) wrapped(b);
    for (const f of this.fx) if (!(f instanceof DeadMonster) && !(f instanceof FireDrop)) f.draw(g, this);
    this.boss?.draw(g, this);
    for (const s of this.shots) s.draw(g);
    this.baron?.draw(g, this);

    // overlays inside the field
    if (this.hurrySign > 0) {
      const id = (this.frame >> 2) & 1 ? 31 : 32;
      const f = g.frame(id);
      g.drawFrame(f, this.level.pw / 2 - f.w / 2, this.level.ph / 2 - f.h / 2);
    }
    if (this.state === 'ready' && this.stateTime < sec(2.2)) {
      g.text(`ROUND ${this.levelIndex + 1}`, this.level.pw / 2, this.level.ph / 2 - 24, '#fff', { align: 'center' });
      if ((this.frame >> 3) & 1) g.text('READY!', this.level.pw / 2, this.level.ph / 2, '#ff5', { align: 'center' });
    }
    if (this.flash) {
      g.text(this.flash.text, this.level.pw / 2, 56, this.flash.color, { align: 'center' });
    }
    this.drawLetters(g);
    ctx.restore();
  }

  private drawRoundNumber(g: Gfx): void {
    g.text(String(this.levelIndex + 1).padStart(2, '0'), 4, 2, '#fff', { scale: 2 });
  }

  private drawLetters(g: Gfx): void {
    for (const p of this.players) {
      if (!p.playing) continue;
      const x = p.index === 0 ? 0 : this.level.pw - 32;
      p.letters.forEach((has, i) => {
        if (has) g.draw(LETTER_IDS[i] + ((this.frame >> 3) % 3), x, 56 + i * 34);
      });
    }
  }

  private drawScroll(g: Gfx): void {
    const ctx = g.ctx;
    const off = -this.scrollY;
    if (this.levelImage) ctx.drawImage(this.levelImage, 0, off);
    if (this.nextImage) ctx.drawImage(this.nextImage, 0, off + this.level.ph);
    const t = this.scrollY / this.level.ph;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    for (const tr of this.travel) {
      const x = tr.fx + (tr.tx - tr.fx) * e;
      const y = tr.fy + (tr.ty - tr.fy) * e + off;
      const d = tr.d.dragon ?? new Dragon(tr.d, 0, 0, 1);
      d.drawTravelling(g, x, y, this.frame);
    }
  }
}
