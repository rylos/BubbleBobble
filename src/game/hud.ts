// Score bar (top) and lives strip (bottom), arcade style.

import type { Gfx } from '../engine/gfx';
import { SCREEN_H, SCREEN_W } from '../engine/gfx';
import { sec } from './const';
import type { World } from './world';

const LABEL = ['1UP', '2UP'];
const LABEL_COLORS = ['#3e3', '#39f'];

export function drawHud(g: Gfx, w: World): void {
  g.rect(0, 0, SCREEN_W, 32, '#000');
  g.rect(0, SCREEN_H - 16, SCREEN_W, 16, '#000');
  // high score in the middle
  g.text('HIGH SCORE', SCREEN_W / 2, 2, '#f33', { align: 'center' });
  g.text(String(w.highScore).padStart(7, ' '), SCREEN_W / 2 + 56, 17, '#fff', { align: 'right' });

  for (let i = 0; i < 2; i++) {
    const p = w.players.find((q) => q.index === i);
    const left = i === 0;
    const x = left ? 16 : SCREEN_W - 16;
    const align = left ? 'left' : 'right';
    const blinkOn = (w.frame >> 4) & 1;
    if (!p || !p.playing) {
      if (blinkOn) g.text(`PUSH ${i + 1}P START`, x, 17, '#ccc', { align, scale: 1.5 });
      g.text(LABEL[i], x, 2, LABEL_COLORS[i], { align });
      continue;
    }
    g.text(LABEL[i], x, 2, LABEL_COLORS[i], { align });
    if (p.gameOver) {
      const s = Math.ceil(p.continueTimer / sec(1));
      if (p.continueTimer > 0) g.text(`CONTINUE ${s}`, x, 17, blinkOn ? '#ff5' : '#fa0', { align, scale: 1.5 });
      else g.text('GAME OVER', x, 17, '#f55', { align, scale: 1.5 });
    } else {
      g.text(String(p.score).padStart(7, ' '), left ? x + 112 : x, 17, '#fff', { align: 'right' });
    }
    // lives as small bubbles at the bottom
    const n = Math.max(0, p.lives - (p.dragon ? 1 : 0));
    const ctx = g.ctx;
    ctx.imageSmoothingEnabled = true;
    for (let k = 0; k < Math.min(n, 8); k++) {
      const bx = left ? 4 + k * 18 : SCREEN_W - 20 - k * 18;
      g.draw(683 + (left ? 1 : 0), bx, SCREEN_H - 16, { p: p.index, scale: 0.5 });
    }
    ctx.imageSmoothingEnabled = false;
    if (n > 8) g.text(`x${n}`, left ? 150 : SCREEN_W - 150, SCREEN_H - 14, '#fff', { align, scale: 1.5 });
  }
}
