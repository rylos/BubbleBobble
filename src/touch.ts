// On-screen controls for phones and tablets.

import type { Button, Input } from './engine/input';

export function setupTouch(input: Input): void {
  const root = document.getElementById('touch');
  if (!root) return;
  const enable = () => document.body.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) enable();
  window.addEventListener('touchstart', enable, { once: true, passive: true });

  root.querySelectorAll<HTMLElement>('[data-btn]').forEach((el) => {
    const btns = el.dataset.btn!.split(' ') as Button[];
    const set = (v: boolean) => {
      for (const b of btns) input.setTouch(b, v);
      el.classList.toggle('on', v);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      set(true);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => set(false));
  });
}
