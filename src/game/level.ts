// A board: wall grid, wind map and the geometry queries used by every sprite.
// Coordinates are pixels with the origin at the playfield's top-left; sprites
// are 32x32 and positioned by their top-left corner (like The Bub's Brothers).

import { CELL } from './const';

export type MonsterType = 'nasty' | 'monky' | 'ghosty' | 'flappy' | 'springy' | 'orcy' | 'gramy' | 'blitzy';

export interface LevelDef {
  walls: string[];
  winds: string[];
  monsters: { type: MonsterType; x: number; y: number; dir: 1 | -1 }[];
  flags: { letter: boolean; fire: boolean; lightning: boolean; water: boolean; top: boolean };
  holes: boolean;
  color: string;
  tile: { w: number; h: number };
  border: { w: number; h: number } | null;
}

export interface LevelSet {
  id: string;
  name: string;
  width: number;
  height: number;
  levels: LevelDef[];
}

export const WIND: Record<string, [number, number]> = {
  '<': [-1, 0],
  '>': [1, 0],
  '^': [0, -1],
  v: [0, 1],
  x: [0, 0],
};

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export class Level {
  readonly w: number;
  readonly h: number;
  readonly pw: number; // pixel width
  readonly ph: number; // pixel height
  readonly wrapH: number; // vertical loop length
  readonly walls: Uint8Array;
  readonly winds: string[];
  /** Bumped whenever walls change, so renderers can refresh. */
  version = 0;

  constructor(
    readonly def: LevelDef,
    readonly index: number,
  ) {
    this.h = def.walls.length;
    this.w = def.walls[0].length;
    this.pw = this.w * CELL;
    this.ph = this.h * CELL;
    this.wrapH = (this.h + 2) * CELL;
    this.walls = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.walls[y * this.w + x] = def.walls[y][x] === '#' ? 1 : 0;
    this.winds = def.winds;
  }

  /** Wall at cell? Outside x is wall; outside y reads row 0 (wrap-around). */
  wall(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= this.w) return true;
    if (cy < 0 || cy >= this.h) cy = 0;
    return this.walls[cy * this.w + cx] === 1;
  }

  setWall(cx: number, cy: number, v: boolean): void {
    if (cx < 0 || cx >= this.w || cy < 0 || cy >= this.h) return;
    this.walls[cy * this.w + cx] = v ? 1 : 0;
    this.version++;
  }

  /** Wind character under a bubble at pixel (x, y). */
  wind(x: number, y: number): string {
    let cx = floorDiv(x + 8, CELL);
    let cy = floorDiv(y + 8, CELL);
    if (cx < 0) return '>';
    if (cx >= this.w) return '<';
    if (cy < 0) cy = 0;
    else if (cy >= this.h) cy = this.h - 1;
    return this.winds[cy][cx];
  }

  private rowEmpty3(row: number, x0: number, x1: number, x2: number): boolean {
    return !this.walls[row * this.w + x0] && !this.walls[row * this.w + x1] && !this.walls[row * this.w + x2];
  }

  /** Is a 32x32 sprite at (x, y) standing on a floor? Only true on 16px boundaries. */
  onGround(x: number, y: number): boolean {
    if (y % CELL !== 0) return false;
    const x0 = floorDiv(x + 5, CELL);
    const x1 = floorDiv(x + 16, CELL);
    const x2 = floorDiv(x + 27, CELL);
    if (x0 < 0 || x2 >= this.w) return false;
    let y0 = floorDiv(y, CELL) + 2;
    let y1 = y0 - 1;
    if (!(y0 > 0 && y0 < this.h)) {
      if (y0 !== this.h) y1 = 0;
      y0 = 0;
    }
    if (y1 < 0 || y1 >= this.h) y1 = ((y1 % this.h) + this.h) % this.h;
    return this.rowEmpty3(y1, x0, x1, x2) && !this.rowEmpty3(y0, x0, x1, x2);
  }

  /** Same test for upside-down gravity (ceiling under the head). */
  onCeiling(x: number, y: number): boolean {
    if (y % CELL !== 0) return false;
    const x0 = floorDiv(x + 5, CELL);
    const x1 = floorDiv(x + 16, CELL);
    const x2 = floorDiv(x + 27, CELL);
    if (x0 < 0 || x2 >= this.w) return false;
    let y0 = floorDiv(y, CELL) - 1;
    let y1 = y0 + 1;
    if (y0 < 0 || y0 >= this.h) y0 = this.h - 1;
    if (y1 < 0 || y1 >= this.h) y1 = 0;
    return this.rowEmpty3(y1, x0, x1, x2) && !this.rowEmpty3(y0, x0, x1, x2);
  }

  /** Is the top border row solid above a 32px sprite at x? */
  ceilingAt(x: number): boolean {
    const x0 = floorDiv(x + 5, CELL);
    const x2 = floorDiv(x + 27, CELL);
    for (let cx = x0; cx <= x2; cx++) if (this.wall(cx, 0)) return true;
    return false;
  }

  /** Keep a sprite inside the vertical loop. */
  warpY(y: number): number {
    if (y >= this.ph) return y - this.wrapH;
    if (y < -32) return y + this.wrapH;
    return y;
  }

  /** Can a 32x32 sprite at (x,y) move one step horizontally in dir? (player rule) */
  canWalk(x: number, y: number, dir: number): boolean {
    let x0: number;
    let ya: number;
    if (dir < 0) {
      x0 = floorDiv(x + 1, CELL);
      ya = floorDiv(y + 4, CELL) + 1;
    } else {
      x0 = floorDiv(x - 3, CELL) + 2;
      ya = floorDiv(y, CELL) + 1;
    }
    const yb = floorDiv(y + CELL - 1, CELL) + 1;
    return !this.wall(x0, ya) && !this.wall(x0, yb);
  }

  /** Is the 32x32 area at (x, y) entirely free of walls? */
  free(x: number, y: number): boolean {
    for (let cy = floorDiv(y, CELL); cy <= floorDiv(y + 31, CELL); cy++)
      for (let cx = floorDiv(x, CELL); cx <= floorDiv(x + 31, CELL); cx++) if (this.wall(cx, cy)) return false;
    return true;
  }

  /** Where a 32x32 item at (x, y) should rest: first free floor below it (wrapping), or the nearest one. */
  landingSpot(x: number, y: number): { x: number; y: number } {
    x = Math.max(2 * CELL, Math.min(this.pw - 4 * CELL, Math.round(x / 2) * 2));
    const start = Math.floor(y / CELL);
    for (let i = 0; i < this.h; i++) {
      const cy = (((start + i) % this.h) + this.h) % this.h;
      if (cy > this.h - 2) continue;
      const py = cy * CELL;
      if (this.onGround(x, py) && this.free(x, py)) return { x, y: py };
    }
    let best = { x, y: (this.h - 3) * CELL };
    let bestD = Infinity;
    for (let cy = 1; cy < this.h - 2; cy++)
      for (let cx = 2; cx < this.w - 3; cx++) {
        const px = cx * CELL;
        const py = cy * CELL;
        if (!this.onGround(px, py) || !this.free(px, py)) continue;
        const d = Math.hypot(px - x, py - y);
        if (d < bestD) {
          bestD = d;
          best = { x: px, y: py };
        }
      }
    return best;
  }

  /** Random spot where a 32x32 item can rest on a floor. */
  randomGround(rand: () => number, avoid: { x: number; y: number }[] = []): { x: number; y: number } | null {
    const spots: { x: number; y: number }[] = [];
    for (let cy = 1; cy < this.h - 2; cy++)
      for (let cx = 2; cx < this.w - 3; cx++) {
        const x = cx * CELL;
        const y = cy * CELL;
        if (!this.onGround(x, y) || !this.free(x, y)) continue;
        if (avoid.some((a) => Math.abs(a.x - x) < 48 && Math.abs(a.y - y) < 48)) continue;
        spots.push({ x, y });
      }
    return spots.length ? spots[Math.floor(rand() * spots.length)] : null;
  }
}
