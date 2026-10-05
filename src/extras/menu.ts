// Extra games menu: the seven mini-games of The Bub's Brothers' extensions.

import type { Frame, Gfx } from '../engine/gfx';
import { SCREEN_H, SCREEN_W } from '../engine/gfx';
import type { App, Scene } from '../scenes';
import { ARKANOID, Arkanoid } from './arkanoid';
import { BIPLANES, Biplanes } from './biplanes';
import { BubbleBackdrop, PCOLORS, loadBest, type GameMeta, type GameOptions } from './common';
import { GALAGA, Galaga } from './galaga';
import { LEMMINGS, Lemmings } from './lemmings';
import { PACMAN, Pacman } from './pacman';
import { TETRIS, Tetris } from './tetris';
import { TRON, Tron } from './tron';

interface Entry {
  meta: GameMeta;
  make: (app: App, opts: GameOptions) => Scene;
  icon: { file: string; w: number; h: number; scale: number; index?: number } | { id: number | string; p?: boolean };
}

const ENTRIES: Entry[] = [
  { meta: ARKANOID, make: (a, o) => new Arkanoid(a, o), icon: { file: 'ext1/image1_{p}.png', w: 80, h: 32, scale: 0.5 } },
  { meta: TETRIS, make: (a, o) => new Tetris(a, o), icon: { file: 'ext4/image1_{p}.png', w: 32, h: 16, scale: 1 } },
  { meta: PACMAN, make: (a, o) => new Pacman(a, o), icon: { id: 443 } },
  { meta: GALAGA, make: (a, o) => new Galaga(a, o), icon: { file: 'ext3/image1_{p}.png', w: 32, h: 32, scale: 1 } },
  { meta: LEMMINGS, make: (a, o) => new Lemmings(a, o), icon: { file: 'ext5/image1.png', w: 32, h: 32, scale: 1, index: 1 } },
  { meta: TRON, make: (a, o) => new Tron(a, o), icon: { file: 'ext6/image1_{p}.png', w: 8, h: 8, scale: 3, index: 3 } },
  { meta: BIPLANES, make: (a, o) => new Biplanes(a, o), icon: { file: 'ext7/image1_{p}.png', w: 36, h: 36, scale: 1, index: 0 } },
];

let lastSel = 0;
const playersOf: Record<string, number> = {};

export class ExtrasMenuScene implements Scene {
  private t = 0;
  private sel = lastSel;
  private backdrop = new BubbleBackdrop();
  private icons = new Map<string, Frame>();

  constructor(
    private app: App,
    private back: () => Scene,
  ) {
    if (app.audio.currentMusic !== 'main2') app.audio.playMusic('main2');
    for (const e of ENTRIES) {
      const ic = e.icon;
      if (!('file' in ic)) continue;
      const file = ic.file.replace('{p}', '0');
      void app.gfx
        .sheet(file)
        .then((img) => {
          const i = ic.index ?? 0;
          const cols = Math.max(1, Math.floor(img.width / ic.w));
          this.icons.set(e.meta.id, { img, x: (i % cols) * ic.w, y: Math.floor(i / cols) * ic.h, w: ic.w, h: ic.h });
        })
        .catch(() => {});
    }
  }

  private players(e: Entry): number {
    return playersOf[e.meta.id] ?? 1;
  }

  private launch(e: Entry): void {
    const players = this.players(e);
    const menu = () => new ExtrasMenuScene(this.app, this.back);
    const opts: GameOptions = {
      players,
      exit: menu,
      restart: () => e.make(this.app, opts),
    };
    lastSel = this.sel;
    this.app.audio.sfx('letsgo');
    this.app.go(e.make(this.app, opts));
  }

  update(): void {
    this.t++;
    this.backdrop.update();
    if (this.t < 15) return;
    const m = this.app.input.menu;
    const n = ENTRIES.length;
    if (m.pressed('up')) this.sel = (this.sel + n - 1) % n;
    if (m.pressed('down')) this.sel = (this.sel + 1) % n;
    const e = ENTRIES[this.sel];
    if (m.pressed('left') || m.pressed('right')) playersOf[e.meta.id] = 3 - this.players(e);
    if (m.pressed('pause')) {
      this.app.audio.sfx('pop');
      this.app.go(this.back());
      return;
    }
    if (m.pressed('confirm')) {
      this.launch(e);
      return;
    }
    if (m.anyPressed()) this.app.audio.sfx('pop');
    lastSel = this.sel;
  }

  draw(g: Gfx): void {
    g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
    this.backdrop.draw(g, this.t);
    g.text('EXTRA GAMES', SCREEN_W / 2, 18, '#ff5', { align: 'center', scale: 3 });
    const best = loadBest();
    ENTRIES.forEach((e, i) => {
      const y = 66 + i * 40;
      const on = i === this.sel;
      if (on) {
        g.rect(16, y - 4, SCREEN_W - 32, 38, '#235', 0.75);
        g.rect(16, y - 4, 3, 38, '#ff5');
      }
      this.drawIcon(g, e, 40, y + 15, on);
      g.text(e.meta.name, 76, y + 2, on ? '#ff5' : '#ddd');
      const b = best[e.meta.id];
      g.text(b ? `BEST ${b}` : e.meta.time ? `${e.meta.time} SEC` : 'ENDLESS', 76, y + 20, '#889', { scale: 1.25 });
      const n = this.players(e);
      const label = e.meta.mode === 'versus' ? (n === 1 ? '1P VS CPU' : '1P VS 2P') : n === 1 ? '1 PLAYER' : '2 PLAYERS';
      const col = on ? PCOLORS[n - 1] : '#777';
      g.text(label, SCREEN_W - 40, y + 8, col, { align: 'right', scale: 1.5 });
      if (on && (this.t >> 4) & 1) {
        g.text('<', SCREEN_W - 40 - g.textWidth(label, 1.5) - 14, y + 8, '#ff5', { scale: 1.5 });
        g.text('>', SCREEN_W - 34, y + 8, '#ff5', { scale: 1.5 });
      }
    });
    const e = ENTRIES[this.sel];
    g.rect(0, 352, SCREEN_W, 1, '#446');
    g.text(e.meta.desc, SCREEN_W / 2, 362, '#fff', { align: 'center', scale: 1.5 });
    g.text(e.meta.controls, SCREEN_W / 2, 382, '#8af', { align: 'center', scale: 1.5 });
    g.text('LEFT/RIGHT PLAYERS  ENTER PLAY  ESC BACK', SCREEN_W / 2, SCREEN_H - 30, '#666', { align: 'center', scale: 1.5 });
  }

  private drawIcon(g: Gfx, e: Entry, cx: number, cy: number, on: boolean): void {
    const bob = on ? Math.sin(this.t / 8) * 2 : 0;
    const ic = e.icon;
    if ('id' in ic) {
      const f = g.frame(ic.id, 0);
      g.drawFrame(f, cx - f.w / 2, cy - f.h / 2 + bob);
      return;
    }
    const f = this.icons.get(e.meta.id);
    if (!f) return;
    const s = ic.scale;
    g.drawFrame(f, cx - (f.w * s) / 2, cy - (f.h * s) / 2 + bob, { scale: s });
  }
}
