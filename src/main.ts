import './style.css';
import { Audio } from './engine/audio';
import { Gfx, SCREEN_H, SCREEN_W } from './engine/gfx';
import { Input } from './engine/input';
import type { LevelSet } from './game/level';
import { TitleScene, type App, type Scene } from './scenes';
import { loadSettings } from './storage';
import { setupTouch } from './touch';

const STEP = 1000 / 60;

async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const gfx = new Gfx(canvas);
  const audio = new Audio();
  const input = new Input();
  const settings = loadSettings();
  audio.setVolumes(settings.musicVolume, settings.sfxVolume);
  document.body.classList.toggle('crt', settings.crt);

  const ctx = gfx.ctx;
  const progress = (done: number, total: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.fillStyle = '#3e3';
    ctx.fillRect(SCREEN_W / 2 - 100, SCREEN_H / 2, (200 * done) / total, 8);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(SCREEN_W / 2 - 101, SCREEN_H / 2 - 1, 202, 10);
  };
  progress(0, 1);
  await Promise.all([gfx.load(progress), audio.init()]);
  const logo = await gfx.loadImage('ui/logo.png');

  const setCache = new Map<string, Promise<LevelSet>>();
  let scene: Scene;
  const app: App = {
    gfx,
    audio,
    input,
    settings,
    logo,
    sets: [
      { id: 'original', name: 'Bub & Bob' },
      { id: 'lost', name: 'Lost Levels' },
      { id: 'fun', name: 'House of Fun' },
      { id: 'arena', name: 'Arena' },
    ],
    loadSet(id) {
      let p = setCache.get(id);
      if (!p) {
        p = fetch(`assets/levels/${id}.json`).then((r) => r.json());
        setCache.set(id, p);
      }
      return p;
    },
    go(s) {
      scene = s;
    },
  };

  // audio needs a user gesture; show a "press any key" screen until then
  let started = false;
  input.onFirstInput = () => {
    audio.unlock();
    started = true;
    scene = new TitleScene(app);
  };
  setupTouch(input);

  scene = {
    update() {},
    draw(g) {
      g.rect(0, 0, SCREEN_W, SCREEN_H, '#000');
      g.ctx.drawImage(logo, SCREEN_W / 2 - logo.width, 60, logo.width * 2, logo.height * 2);
      if (Math.floor(performance.now() / 500) % 2) g.text('PRESS ANY KEY', SCREEN_W / 2, 330, '#fff', { align: 'center' });
      g.text('OR TAP THE SCREEN', SCREEN_W / 2, 360, '#888', { align: 'center', scale: 1.5 });
    },
  };

  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= STEP) {
      acc -= STEP;
      input.poll();
      if (started) scene.update();
      else scene.update();
    }
    scene.draw(gfx);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const resize = () => {
    const touch = document.body.classList.contains('touch');
    const availH = window.innerHeight * (touch ? 0.62 : 1);
    const scale = Math.min(window.innerWidth / SCREEN_W, availH / SCREEN_H);
    const s = scale >= 1 ? Math.floor(scale * 4) / 4 : scale;
    canvas.style.width = `${Math.floor(SCREEN_W * s)}px`;
    canvas.style.height = `${Math.floor(SCREEN_H * s)}px`;
  };
  window.addEventListener('resize', resize);
  resize();
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#f66;padding:16px">${String(e?.stack ?? e)}</pre>`;
});
