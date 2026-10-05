// Canvas 2D renderer for the 512x448 logical screen: sprite sheets, bitmap font, effects.

export const SCREEN_W = 512;
export const SCREEN_H = 448;

type SpriteEntry = [file: string, x: number, y: number, w: number, h: number];

export interface Frame {
  img: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawOpts {
  p?: number; // player colour for '{p}' sheets
  flipX?: boolean;
  flipY?: boolean;
  alpha?: number;
  scale?: number;
  rot?: number; // radians, around the sprite centre
}

const FONT_COLS = 16;
const GLYPH = 8;
const BASE = 'assets/';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${src}`));
    img.src = src;
  });
}

export class Gfx {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private sheets = new Map<string, HTMLImageElement>();
  private sprites: Record<string, SpriteEntry> = {};
  private frames = new Map<string, Frame>();
  private font!: HTMLImageElement;
  private tintedFonts = new Map<string, HTMLCanvasElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas 2d not supported');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    this.sprites = await (await fetch(BASE + 'sprites/sprites.json')).json();
    const files = new Set<string>();
    for (const [file] of Object.values(this.sprites)) {
      if (file.includes('{p}')) for (let p = 0; p < 4; p++) files.add(file.replace('{p}', String(p)));
      else files.add(file);
    }
    const list = [...files];
    let done = 0;
    await Promise.all(
      list.map(async (f) => {
        this.sheets.set(f, await loadImage(BASE + 'sprites/' + f));
        onProgress?.(++done, list.length);
      }),
    );
    this.font = await loadImage(BASE + 'sprites/font.png');
  }

  async loadImage(path: string): Promise<HTMLImageElement> {
    return loadImage(BASE + path);
  }

  /** Lazily load an extra sheet that is not referenced by sprites.json. */
  async sheet(file: string): Promise<HTMLImageElement> {
    let img = this.sheets.get(file);
    if (!img) {
      img = await loadImage(BASE + 'sprites/' + file);
      this.sheets.set(file, img);
    }
    return img;
  }

  frame(id: number | string, p = 0): Frame {
    const key = `${id}|${p}`;
    let f = this.frames.get(key);
    if (f) return f;
    const e = this.sprites[String(id)];
    if (!e) throw new Error(`unknown sprite ${id}`);
    const img = this.sheets.get(e[0].replace('{p}', String(p)));
    if (!img) throw new Error(`sheet not loaded: ${e[0]}`);
    f = { img, x: e[1], y: e[2], w: e[3], h: e[4] };
    this.frames.set(key, f);
    return f;
  }

  has(id: number | string): boolean {
    return String(id) in this.sprites;
  }

  /** Draw a sprite with its top-left corner at (x, y). */
  draw(id: number | string, x: number, y: number, o: DrawOpts = {}): void {
    this.drawFrame(this.frame(id, o.p ?? 0), x, y, o);
  }

  drawFrame(f: Frame, x: number, y: number, o: DrawOpts = {}): void {
    const ctx = this.ctx;
    const s = o.scale ?? 1;
    const w = f.w * s;
    const h = f.h * s;
    x = Math.round(x);
    y = Math.round(y);
    const transformed = o.flipX || o.flipY || o.rot;
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    if (transformed) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      if (o.rot) ctx.rotate(o.rot);
      ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
      ctx.drawImage(f.img, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(f.img, f.x, f.y, f.w, f.h, x, y, w, h);
    }
    if (o.alpha !== undefined) ctx.globalAlpha = 1;
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
    this.ctx.globalAlpha = 1;
  }

  private fontFor(color: string): HTMLCanvasElement {
    let c = this.tintedFonts.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.font.width;
      c.height = this.font.height;
      const x = c.getContext('2d')!;
      x.drawImage(this.font, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = color;
      x.fillRect(0, 0, c.width, c.height);
      this.tintedFonts.set(color, c);
    }
    return c;
  }

  textWidth(s: string, scale = 2): number {
    return s.length * GLYPH * scale;
  }

  /**
   * Draw text with the 8x8 bitmap font. `align`: 'left' | 'center' | 'right'.
   * A dark drop shadow keeps it readable over the playfield.
   */
  text(
    s: string,
    x: number,
    y: number,
    color = '#fff',
    o: { align?: 'left' | 'center' | 'right'; scale?: number; shadow?: string | null } = {},
  ): void {
    const scale = o.scale ?? 2;
    const w = this.textWidth(s, scale);
    if (o.align === 'center') x -= w / 2;
    else if (o.align === 'right') x -= w;
    x = Math.round(x);
    y = Math.round(y);
    if (o.shadow !== null) this.textRaw(s, x + scale, y + scale, o.shadow ?? '#000', scale);
    this.textRaw(s, x, y, color, scale);
  }

  private textRaw(s: string, x: number, y: number, color: string, scale: number): void {
    const font = this.fontFor(color);
    const g = GLYPH * scale;
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 97 && c <= 122) c -= 32; // the font's lowercase is tiny: use capitals
      if (c < 32 || c > 127) c = 63;
      const idx = c - 32;
      if (idx === 0) continue;
      const sx = (idx % FONT_COLS) * GLYPH;
      const sy = Math.floor(idx / FONT_COLS) * GLYPH;
      this.ctx.drawImage(font, sx, sy, GLYPH, GLYPH, x + i * g, y, g, g);
    }
  }
}
