// Keyboard + gamepad input, mapped to per-player arcade buttons.

export type Button = 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire' | 'start' | 'pause' | 'confirm';
const BUTTONS: Button[] = ['left', 'right', 'up', 'down', 'jump', 'fire', 'start', 'pause', 'confirm'];

export type KeyMap = Record<Button, string[]>;

export const DEFAULT_KEYS: KeyMap[] = [
  {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    jump: ['KeyX', 'ArrowUp', 'Space'],
    fire: ['KeyZ', 'ControlLeft', 'KeyC'],
    start: ['Enter', 'Digit1'],
    pause: ['Escape', 'KeyP'],
    confirm: ['Enter', 'Space', 'KeyZ', 'KeyX'],
  },
  {
    left: ['KeyA'],
    right: ['KeyD'],
    up: ['KeyW'],
    down: ['KeyS'],
    jump: ['KeyW', 'KeyG'],
    fire: ['KeyF', 'KeyQ'],
    start: ['Digit2'],
    pause: [],
    confirm: ['KeyF', 'KeyG'],
  },
];

/** Per-player button state for one frame. */
export class Pad {
  held: Record<Button, boolean>;
  private prev: Record<Button, boolean>;
  constructor() {
    this.held = Object.fromEntries(BUTTONS.map((b) => [b, false])) as Record<Button, boolean>;
    this.prev = { ...this.held };
  }
  pressed(b: Button): boolean {
    return this.held[b] && !this.prev[b];
  }
  /** Horizontal direction: -1, 0, +1. */
  get dx(): number {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }
  any(): boolean {
    return BUTTONS.some((b) => this.held[b]);
  }
  anyPressed(): boolean {
    return BUTTONS.some((b) => this.pressed(b));
  }
  /** Called by Input: shift current state to previous, then set the new one. */
  update(next: Record<Button, boolean>): void {
    this.prev = this.held;
    this.held = next;
  }
}

export class Input {
  readonly pads = [new Pad(), new Pad()];
  /** Any-player pad: OR of every input source (menus). */
  readonly menu = new Pad();
  keys: KeyMap[] = DEFAULT_KEYS;
  private down = new Set<string>();
  /** Keys pressed since the last poll (so quick taps between frames are not lost). */
  private tapped = new Set<string>();
  private touch: Record<Button, boolean> = Object.fromEntries(BUTTONS.map((b) => [b, false])) as Record<Button, boolean>;
  onFirstInput: (() => void) | null = null;
  lastKey: string | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F11' || e.ctrlKey || e.metaKey) return;
      this.down.add(e.code);
      this.tapped.add(e.code);
      this.lastKey = e.code;
      this.first();
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('pointerdown', () => this.first());
  }

  private first(): void {
    if (this.onFirstInput) {
      const f = this.onFirstInput;
      this.onFirstInput = null;
      f();
    }
  }

  setTouch(b: Button, v: boolean): void {
    this.touch[b] = v;
    if (v) this.first();
  }

  poll(): void {
    const gps = navigator.getGamepads ? [...navigator.getGamepads()].filter((g): g is Gamepad => !!g) : [];
    const menuState = Object.fromEntries(BUTTONS.map((b) => [b, false])) as Record<Button, boolean>;
    this.pads.forEach((pad, i) => {
      const map = this.keys[i];
      const s = Object.fromEntries(BUTTONS.map((b) => [b, map[b].some((k) => this.down.has(k) || this.tapped.has(k))])) as Record<Button, boolean>;
      if (i === 0) for (const b of BUTTONS) s[b] ||= this.touch[b];
      const gp = gps[i];
      if (gp) {
        const btn = (n: number) => !!gp.buttons[n]?.pressed;
        const ax = gp.axes[0] ?? 0;
        const ay = gp.axes[1] ?? 0;
        s.left ||= btn(14) || ax < -0.4;
        s.right ||= btn(15) || ax > 0.4;
        s.up ||= btn(12) || ay < -0.5;
        s.down ||= btn(13) || ay > 0.5;
        s.jump ||= btn(0) || btn(3);
        s.fire ||= btn(1) || btn(2) || btn(5) || btn(7);
        s.start ||= btn(9);
        s.pause ||= btn(8);
        s.confirm ||= btn(0) || btn(1) || btn(9);
        if (gp.buttons.some((b) => b.pressed)) this.first();
      }
      pad.update(s);
      for (const b of BUTTONS) menuState[b] ||= s[b];
    });
    this.menu.update(menuState);
    this.tapped.clear();
  }
}
