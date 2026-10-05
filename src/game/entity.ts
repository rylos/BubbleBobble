import type { Gfx } from '../engine/gfx';
import type { World } from './world';

export const rand = Math.random;
export const randInt = (n: number) => Math.floor(Math.random() * n);
export const choice = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export abstract class Entity {
  x = 0;
  y = 0;
  w = 32;
  h = 32;
  dead = false;
  /** Frames since creation. */
  age = 0;

  abstract update(world: World): void;
  abstract draw(g: Gfx, world: World): void;

  kill(): void {
    this.dead = true;
  }

  /** Rect overlap with an inset margin on this entity (like Bub's Brothers touching(margin)). */
  overlaps(o: { x: number; y: number; w: number; h: number }, margin = 0): boolean {
    return (
      this.x + margin < o.x + o.w &&
      o.x < this.x + this.w - margin &&
      this.y + margin < o.y + o.h &&
      o.y < this.y + this.h - margin
    );
  }

  get cx(): number {
    return this.x + this.w / 2;
  }
  get cy(): number {
    return this.y + this.h / 2;
  }
}

/** Cycle through frames, `hold` frames each. */
export function anim(frames: readonly (number | string)[], t: number, hold: number): number | string {
  return frames[Math.floor(t / hold) % frames.length];
}

export const range = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i);
