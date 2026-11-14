// Navball logic without DOM: click-vs-drag threshold and where the bubbles fan out.
export const DRAG_PX = 4;
/** A press that travelled further than this is a drag, not a click. */
export const isDrag = (dx: number, dy: number) => Math.hypot(dx, dy) > DRAG_PX;

export const BUBBLE = 40;
const RINGS = [80, 128]; // second ring only fills in when the first is cut off by a screen edge
const STEP = Math.PI / 6;
export interface Slot { x: number; y: number }

/** Bubble offsets from the ball centre. They fan towards the middle of the window
 *  (away from the screen edge the window was pushed against), up when the ball is centred. */
export function fanSlots(ball: Slot, size: number, count: number): Slot[] {
  const dx = size / 2 - ball.x, dy = size / 2 - ball.y;
  const toward = Math.hypot(dx, dy) < 24 ? -Math.PI / 2 : Math.atan2(dy, dx);
  const m = BUBBLE / 2 + 2;
  const fits = (s: Slot) => ball.x + s.x >= m && ball.x + s.x <= size - m && ball.y + s.y >= m && ball.y + s.y <= size - m;
  // Offsets of ±15°, ±45°, … so an odd arc never leans to one side.
  const all = RINGS.flatMap((r, ring) => Array.from({ length: 12 }, (_, k) => {
    const rel = (k - 6 + 0.5) * STEP;
    const slot = { x: r * Math.cos(toward + rel), y: r * Math.sin(toward + rel) };
    return { slot, rel, ring, out: fits(slot) ? 0 : 1 };
  }));
  all.sort((a, b) => a.out - b.out || a.ring - b.ring || Math.abs(a.rel) - Math.abs(b.rel));
  return all.slice(0, count).sort((a, b) => a.rel - b.rel).map((c) => c.slot);
}
