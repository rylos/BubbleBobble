// Screens: title/menu, game, name entry, high scores, options.

import type { Audio } from './engine/audio';
import type { Gfx } from './engine/gfx';
import { SCREEN_H, SCREEN_W } from './engine/gfx';
import type { Input } from './engine/input';
import { sec } from './game/const';
import { drawHud } from './game/hud';
import type { LevelSet } from './game/level';
import { LevelImages, World } from './game/world';
import { ExtrasMenuScene } from './extras/menu';
import { addScore, isHighScore, loadScores, saveSettings, type Settings } from './storage';

export interface Scene {
  update(): void;
  draw(g: Gfx): void;
}

export interface App {
  gfx: Gfx;
  audio: Audio;
  input: Input;
  settings: Settings;
  sets: { id: string; name: string }[];
  logo: HTMLImageElement;
  loadSet(id: string): Promise<LevelSet>;
  go(scene: Scene): void;
}

// --- background with floating bubbles ------------------------------------------

class BubbleBackdrop {
  private bubbles = Array.from({ length: 18 }, () => this.make(true));
  private make(anywhere: boolean) {
    return {
      x: Math.random() * (SCREEN_W - 32),
      y: anywhere ? Math.random() * SCREEN_H : SCREEN_H + Math.random() * 60,
      v: 0.4 + Math.random() * 0.8,
      p: Math.floor(Math.random() * 4),
      ph: Math.random() * 6,
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
    for (const b of this.bubbles) g.draw(188 + [1, 2, 1, 0][Math.floor((t + b.ph * 10) / 8) % 4], b.x + Math.sin(b.ph) * 8, b.y, { p: b.p, alpha: 0.55 });
  }
}

// --- title -------------------------------------------------------------------------

type MenuItem = { label: () => string; act?: () => void; left?: () => void; right?: () => void };

export class TitleScene implements Scene {
  private t = 0;
  private sel = 0;
  private backdrop = new BubbleBackdrop();
  private items: MenuItem[];
  private startRound = 1;
  private idle = 0;
  private busy = false;

  constructor(private app: App) {
    const s = app.settings;
    const setIdx = () => Math.max(0, app.sets.findIndex((x) => x.id === s.levelSet));
    const cycleSet = (d: number) => {
      const i = (setIdx() + d + app.sets.length) % app.sets.length;
      s.levelSet = app.sets[i].id;
      saveSettings(s);
    };
    this.items = [
      { label: () => '1 PLAYER START', act: () => this.start(1) },
      { label: () => '2 PLAYERS START', act: () => this.start(2) },
      { label: () => `LEVELS: ${app.sets[setIdx()].name.toUpperCase()}`, left: () => cycleSet(-1), right: () => cycleSet(1), act: () => cycleSet(1) },
      {
        label: () => `START ROUND: ${String(this.startRound).padStart(3, ' ')}`,
        left: () => (this.startRound = this.startRound > 1 ? this.startRound - 1 : 100),
        right: () => (this.startRound = this.startRound < 100 ? this.startRound + 1 : 1),
      },
      { label: () => 'EXTRA GAMES', act: () => app.go(new ExtrasMenuScene(app, () => new TitleScene(app))) },
      { label: () => 'OPTIONS', act: () => app.go(new OptionsScene(app)) },
      { label: () => 'HIGH SCORES', act: () => app.go(new HighScoreScene(app)) },
    ];
    app.audio.playMusic('main2');
  }

  private async start(players: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.app.audio.sfx('letsgo');
    const set = await this.app.loadSet(this.app.settings.levelSet);
    const game = new GameScene(this.app, set, players, this.startRound - 1);
    await game.ready;
    this.app.go(this.startRound === 1 ? new IntroScene(this.app, game, players) : game);
  }

  update(): void {
    this.t++;
    this.backdrop.update();
    const m = this.app.input.menu;
    if (this.t < 20) return; // ignore the key that opened the menu
    if (m.anyPressed()) this.idle = 0;
    else if (++this.idle > sec(25)) this.app.go(new HighScoreScene(this.app));
    if (m.pressed('up')) this.sel = (this.sel + this.items.length - 1) % this.items.length;
    if (m.pressed('down')) this.sel = (this.sel + 1) % this.items.length;
    const it = this.items[this.sel];
    if (m.pressed('left')) it.left?.();
    if (m.pressed('right')) it.right?.();
    if (m.pressed('confirm')) it.act?.();
    if (m.anyPressed()) this.app.audio.sfx('pop', 0);
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    const logo = this.app.logo;
    const bob = Math.sin(this.t / 30) * 4;
    g.ctx.drawImage(logo, SCREEN_W / 2 - logo.width, 24 + bob, logo.width * 2, logo.height * 2);
    // Bub and Bob dancing next to the logo
    const walk = Math.floor(this.t / 8) % 3;
    g.draw(213 + walk, 36, 160, { p: 0, scale: 2 });
    g.draw(210 + walk, SCREEN_W - 100, 160, { p: 1, scale: 2 });
    this.items.forEach((it, i) => {
      const y = 258 + i * 22;
      const on = i === this.sel;
      g.text(it.label(), SCREEN_W / 2, y, on ? '#ff5' : '#ccc', { align: 'center' });
      if (on) {
        const w = g.textWidth(it.label());
        g.draw(190, SCREEN_W / 2 - w / 2 - 40, y - 8, { p: 0, alpha: 0.9 });
      }
    });
    g.text('ARROWS MOVE  X JUMP  Z BUBBLE', SCREEN_W / 2, SCREEN_H - 34, '#8af', { align: 'center', scale: 1.5 });
    g.text('(C) TAITO 1986  MCSEBI  BUB&BROS', SCREEN_W / 2, SCREEN_H - 16, '#666', { align: 'center', scale: 1.5 });
  }
}

// --- arcade intro ------------------------------------------------------------------

class IntroScene implements Scene {
  private t = 0;
  private backdrop = new BubbleBackdrop();
  private static readonly LINES = [
    'NOW IT IS THE BEGINNING OF',
    'A FANTASTIC STORY!',
    "LET'S MAKE A JOURNEY TO",
    'THE CAVE OF MONSTERS!',
    'GOOD LUCK!',
  ];
  constructor(
    private app: App,
    private game: GameScene,
    private players: number,
  ) {
    app.audio.playMusic('intro', false);
  }
  update(): void {
    this.t++;
    this.backdrop.update();
    if (this.t > 30 && this.app.input.menu.anyPressed()) this.t = Math.max(this.t, sec(7));
    if (this.t > sec(7.5)) this.app.go(this.game);
  }
  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    const shown = Math.floor(this.t / 3);
    let used = 0;
    IntroScene.LINES.forEach((line, i) => {
      const n = Math.max(0, Math.min(line.length, shown - used));
      used += line.length + 4;
      g.text(line.slice(0, n), SCREEN_W / 2 - g.textWidth(line) / 2, 70 + i * 34 + (i >= 2 ? 16 : 0) + (i === 4 ? 16 : 0), i === 4 ? '#ff5' : '#fff');
    });
    // Bub and Bob float up inside their bubbles
    for (let i = 0; i < this.players; i++) {
      const x = i === 0 ? 150 : 300;
      const y = SCREEN_H - 40 - Math.min(170, this.t * 0.6) + Math.sin(this.t / 15 + i) * 6;
      g.draw(693 + (Math.floor(this.t / 8) % 3), x, y, { p: i, scale: 2 });
      g.draw(190, x, y, { p: i, scale: 2, alpha: 0.45 });
    }
  }
}

// --- game ---------------------------------------------------------------------------

export class GameScene implements Scene {
  readonly world: World;
  readonly ready: Promise<void>;
  private overTimer = 0;
  private ending = false;

  constructor(
    private app: App,
    set: LevelSet,
    players: number,
    startLevel: number,
  ) {
    const best = loadScores()[0]?.score ?? 0;
    this.world = new World(
      app.gfx,
      app.audio,
      app.input,
      set,
      new LevelImages(app.gfx, set),
      { autoJump: app.settings.autoJump, startLevel },
      {
        gameOver: () => (this.overTimer = 1),
        allClear: () => {
          this.ending = true;
          this.overTimer = 1;
        },
      },
      best,
    );
    this.ready = this.world.start(players);
    if (import.meta.env.DEV) (window as unknown as { bb: unknown }).bb = this.world;
  }

  update(): void {
    const w = this.world;
    if (this.app.input.menu.pressed('pause')) {
      w.paused = !w.paused;
      this.app.audio.sfx('pop');
    }
    if (w.paused) {
      if (this.app.input.pads[0].pressed('fire') && this.app.input.menu.held.down) this.finish();
      return;
    }
    w.update();
    if (this.overTimer > 0 && ++this.overTimer > sec(this.ending ? 6 : 4)) this.finish();
  }

  private finish(): void {
    const set = this.world.set;
    const entries = this.world.players
      .filter((p) => isHighScore(p.score))
      .map((p) => ({ player: p.index, score: p.score, round: this.world.levelIndex + 1, set: set.id }));
    this.app.go(entries.length ? new NameEntryScene(this.app, entries) : new HighScoreScene(this.app));
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.world.draw(g);
    drawHud(g, this.world);
    if (this.overTimer > 0) {
      const text = this.ending ? 'CONGRATULATIONS!' : 'GAME OVER';
      g.rect(0, SCREEN_H / 2 - 40, SCREEN_W, 72, '#000', 0.6);
      g.text(text, SCREEN_W / 2, SCREEN_H / 2 - 20, this.ending ? '#ff5' : '#f44', { align: 'center', scale: 3 });
      if (this.ending) g.text('BUB & BOB ARE HUMANS AGAIN', SCREEN_W / 2, SCREEN_H / 2 + 12, '#fff', { align: 'center' });
    }
    if (this.world.paused) {
      g.rect(0, 0, SCREEN_W, SCREEN_H, '#000', 0.55);
      g.text('PAUSE', SCREEN_W / 2, SCREEN_H / 2 - 24, '#ff5', { align: 'center', scale: 3 });
      g.text('ESC/P RESUME', SCREEN_W / 2, SCREEN_H / 2 + 16, '#ccc', { align: 'center' });
      g.text('DOWN+BUBBLE QUIT', SCREEN_W / 2, SCREEN_H / 2 + 40, '#ccc', { align: 'center' });
    }
  }
}

// --- name entry ---------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.!?-0123456789 ';

class NameEntryScene implements Scene {
  private name = [0, 0, 0];
  private pos = 0;
  private t = 0;
  private backdrop = new BubbleBackdrop();

  constructor(
    private app: App,
    private queue: { player: number; score: number; round: number; set: string }[],
  ) {
    app.audio.playMusic('potion');
  }

  update(): void {
    this.t++;
    this.backdrop.update();
    const e = this.queue[0];
    const pad = this.app.input.pads[e.player];
    const m = this.app.input.menu;
    const up = pad.pressed('up') || pad.pressed('right') || (e.player === 0 && m.pressed('up'));
    const down = pad.pressed('down') || pad.pressed('left') || (e.player === 0 && m.pressed('down'));
    if (up) this.name[this.pos] = (this.name[this.pos] + 1) % ALPHABET.length;
    if (down) this.name[this.pos] = (this.name[this.pos] + ALPHABET.length - 1) % ALPHABET.length;
    if (pad.pressed('fire') || pad.pressed('start')) {
      this.app.audio.sfx('pop');
      if (++this.pos >= 3) {
        const name = this.name.map((i) => ALPHABET[i]).join('');
        const rank = addScore({ name, score: e.score, round: e.round, set: e.set });
        this.queue.shift();
        if (this.queue.length) {
          this.name = [0, 0, 0];
          this.pos = 0;
        } else this.app.go(new HighScoreScene(this.app, rank));
      }
    }
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    const e = this.queue[0];
    g.text('CONGRATULATIONS!', SCREEN_W / 2, 60, '#ff5', { align: 'center', scale: 3 });
    g.text(`PLAYER ${e.player + 1}`, SCREEN_W / 2, 120, e.player ? '#39f' : '#3e3', { align: 'center' });
    g.text(`SCORE ${e.score}`, SCREEN_W / 2, 150, '#fff', { align: 'center' });
    g.text('ENTER YOUR INITIALS', SCREEN_W / 2, 200, '#ccc', { align: 'center' });
    for (let i = 0; i < 3; i++) {
      const x = SCREEN_W / 2 - 60 + i * 48;
      const on = i === this.pos;
      g.text(ALPHABET[this.name[i]], x, 250, on && (this.t >> 3) & 1 ? '#ff5' : '#fff', { scale: 4 });
      if (on) g.rect(x, 290, 32, 4, '#ff5');
    }
    g.text('UP/DOWN LETTER  BUBBLE OK', SCREEN_W / 2, 340, '#8af', { align: 'center', scale: 1.5 });
  }
}

// --- high scores --------------------------------------------------------------------------

class HighScoreScene implements Scene {
  private t = 0;
  private backdrop = new BubbleBackdrop();
  constructor(
    private app: App,
    private highlight = -1,
  ) {
    if (app.audio.currentMusic !== 'potion' && app.audio.currentMusic !== 'main2') app.audio.playMusic('main2');
  }
  update(): void {
    this.t++;
    this.backdrop.update();
    if (this.t > 20 && (this.app.input.menu.anyPressed() || this.t > sec(15))) this.app.go(new TitleScene(this.app));
  }
  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    g.text('BEST PLAYERS', SCREEN_W / 2, 30, '#ff5', { align: 'center', scale: 3 });
    const colors = ['#f44', '#fa3', '#ff5', '#3e3', '#3cf', '#39f', '#a6f', '#f6c', '#fff', '#ccc'];
    loadScores().forEach((s, i) => {
      const y = 96 + i * 30;
      const c = i === this.highlight && (this.t >> 3) & 1 ? '#fff' : colors[i];
      g.text(`${String(i + 1).padStart(2, ' ')}  ${s.name}  ${String(s.score).padStart(8, ' ')}  R${String(s.round).padStart(3, '0')}`, SCREEN_W / 2, y, c, {
        align: 'center',
      });
      g.draw(593 + Math.min(6, i), 40, y - 10, { scale: 0.75 });
    });
  }
}

// --- options --------------------------------------------------------------------------------

class OptionsScene implements Scene {
  private sel = 0;
  private t = 0;
  private backdrop = new BubbleBackdrop();
  private items: MenuItem[];

  constructor(private app: App) {
    const s = app.settings;
    const vol = (v: number) => '#'.repeat(Math.round(v * 10)).padEnd(10, '.');
    const apply = () => {
      app.audio.setVolumes(s.musicVolume, s.sfxVolume);
      saveSettings(s);
      document.body.classList.toggle('crt', s.crt);
    };
    const step = (k: 'musicVolume' | 'sfxVolume', d: number) => {
      s[k] = Math.max(0, Math.min(1, Math.round((s[k] + d) * 10) / 10));
      apply();
    };
    this.items = [
      { label: () => `MUSIC  ${vol(s.musicVolume)}`, left: () => step('musicVolume', -0.1), right: () => step('musicVolume', 0.1) },
      { label: () => `SOUND  ${vol(s.sfxVolume)}`, left: () => step('sfxVolume', -0.1), right: () => step('sfxVolume', 0.1) },
      { label: () => `CRT FILTER  ${s.crt ? 'ON ' : 'OFF'}`, act: () => ((s.crt = !s.crt), apply()), left: () => ((s.crt = !s.crt), apply()), right: () => ((s.crt = !s.crt), apply()) },
      {
        label: () => `UP ALSO JUMPS  ${s.autoJump ? 'ON ' : 'OFF'}`,
        act: () => ((s.autoJump = !s.autoJump), apply()),
        left: () => ((s.autoJump = !s.autoJump), apply()),
        right: () => ((s.autoJump = !s.autoJump), apply()),
      },
      { label: () => 'FULLSCREEN', act: () => void document.documentElement.requestFullscreen?.().catch(() => {}) },
      { label: () => 'BACK', act: () => app.go(new TitleScene(app)) },
    ];
  }

  update(): void {
    this.t++;
    this.backdrop.update();
    const m = this.app.input.menu;
    if (m.pressed('up')) this.sel = (this.sel + this.items.length - 1) % this.items.length;
    if (m.pressed('down')) this.sel = (this.sel + 1) % this.items.length;
    const it = this.items[this.sel];
    if (m.pressed('left')) it.left?.();
    if (m.pressed('right')) it.right?.();
    if (m.pressed('confirm')) it.act?.();
    if (m.pressed('pause')) this.app.go(new TitleScene(this.app));
    if (m.anyPressed()) this.app.audio.sfx('pop');
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    g.text('OPTIONS', SCREEN_W / 2, 40, '#ff5', { align: 'center', scale: 3 });
    this.items.forEach((it, i) => {
      g.text(it.label(), SCREEN_W / 2, 130 + i * 36, i === this.sel ? '#ff5' : '#ccc', { align: 'center' });
    });
    g.text('PLAYER 1: ARROWS, X JUMP, Z BUBBLE, ENTER', SCREEN_W / 2, 360, '#8af', { align: 'center', scale: 1.5 });
    g.text('PLAYER 2: A/D, W JUMP, F BUBBLE, 2 JOIN', SCREEN_W / 2, 380, '#8af', { align: 'center', scale: 1.5 });
    g.text('GAMEPADS: A JUMP, B BUBBLE, START', SCREEN_W / 2, 400, '#8af', { align: 'center', scale: 1.5 });
  }
}
