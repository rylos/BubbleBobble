// Headless smoke test: open the game, run a key script, save screenshots.
// usage: node tools/shot.mjs <url> <outdir> "<script>"
// script: '|'-separated steps: "wait:ms", "down:Key", "up:Key", "tap:Key", "shot:name", "eval:js"
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [url = 'http://localhost:5173/', out = '/tmp/shots', script = 'wait:1500|shot:boot'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const [vw, vh] = (process.env.VIEWPORT || '1100x980').split('x').map(Number);
const mobile = !!process.env.MOBILE;
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1100,980', '--use-gl=swiftshader'],
  defaultViewport: { width: vw, height: vh, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.stack || e}`));
await page.goto(url, { waitUntil: 'networkidle0' });
for (const step of script.split('|')) {
  const [op, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (op === 'wait') await new Promise((r) => setTimeout(r, Number(arg)));
  else if (op === 'down') await page.keyboard.down(arg);
  else if (op === 'up') await page.keyboard.up(arg);
  else if (op === 'tap') { await page.keyboard.down(arg); await new Promise((r) => setTimeout(r, 90)); await page.keyboard.up(arg); await new Promise((r) => setTimeout(r, 90)); }
  else if (op === 'page') await page.screenshot({ path: `${out}/${arg}.png` });
  else if (op === 'touch') { const [x, y] = arg.split(',').map(Number); await page.touchscreen.tap(x, y); }
  else if (op === 'shot') {
    const el = await page.$('#screen');
    await el.screenshot({ path: `${out}/${arg}.png` });
  } else if (op === 'eval') console.log('eval:', await page.evaluate(arg));
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
