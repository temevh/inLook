// Navball logic without DOM or Electron: click-vs-drag threshold, bubble fan, window geometry.
// Runs the built code in dist (see `pretest`).
import { describe, expect, it } from "vitest";
import { BUBBLE, DRAG_PX, fanSlots, isDrag } from "../dist/web/renderer/widget/ball.js";
import { CLOSED, clampHome, closedBounds, OPEN, openBounds } from "../dist/main/geometry.js";

describe("isDrag", () => {
  it("treats a press that stays within a few px as a click", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(DRAG_PX, 0)).toBe(false);
    expect(isDrag(2, 2)).toBe(false);
  });
  it("treats anything further, in any direction, as a drag", () => {
    expect(isDrag(DRAG_PX + 1, 0)).toBe(true);
    expect(isDrag(0, -(DRAG_PX + 1))).toBe(true);
    expect(isDrag(4, 4)).toBe(true);
  });
});

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = { x: OPEN / 2, y: OPEN / 2 };
const half = CLOSED / 2;

function expectFan(ball: { x: number; y: number }, count = 6) {
  const slots = fanSlots(ball, OPEN, count);
  expect(slots).toHaveLength(count);
  for (const s of slots) {
    // every bubble stays inside the window and clear of the ball
    expect(ball.x + s.x).toBeGreaterThanOrEqual(BUBBLE / 2);
    expect(ball.x + s.x).toBeLessThanOrEqual(OPEN - BUBBLE / 2);
    expect(ball.y + s.y).toBeGreaterThanOrEqual(BUBBLE / 2);
    expect(ball.y + s.y).toBeLessThanOrEqual(OPEN - BUBBLE / 2);
    expect(Math.hypot(s.x, s.y)).toBeGreaterThan(28 + BUBBLE / 2);
  }
  // and clear of each other
  slots.forEach((a, i) => slots.slice(i + 1).forEach((b) => expect(dist(a, b)).toBeGreaterThanOrEqual(BUBBLE)));
  return slots;
}

describe("fanSlots", () => {
  it("fans a centred ball upwards in a symmetric arc", () => {
    const slots = expectFan(centre);
    expect(slots.every((s) => s.y < 0)).toBe(true);
    expect(slots.reduce((sum, s) => sum + s.x, 0)).toBeCloseTo(0, 6);
  });
  it("fans away from the screen edge the ball is pushed against", () => {
    expect(expectFan({ x: half, y: OPEN / 2 }).every((s) => s.x > 0)).toBe(true); // left edge
    expect(expectFan({ x: OPEN - half, y: OPEN / 2 }).every((s) => s.x < 0)).toBe(true); // right edge
    expect(expectFan({ x: OPEN / 2, y: half }).every((s) => s.y > 0)).toBe(true); // top edge
  });
  it("fits seven bubbles (with the close bubble) centred and in every corner", () => {
    expectFan(centre, 7);
    for (const ball of [{ x: half, y: half }, { x: OPEN - half, y: half }, { x: half, y: OPEN - half }, { x: OPEN - half, y: OPEN - half }]) expectFan(ball, 7);
  });
  it("still fits all bubbles in a corner (second ring)", () => {
    for (const ball of [{ x: half, y: half }, { x: OPEN - half, y: half }, { x: half, y: OPEN - half }, { x: OPEN - half, y: OPEN - half }]) expectFan(ball);
  });
});

describe("window geometry", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const home = { x: 800, y: 500 };
  const ballOnScreen = (h: { x: number; y: number }) => ({ x: h.x + half, y: h.y + half });

  it("opens centred on the ball when there is room", () => {
    const { bounds, ball } = openBounds(home, area);
    expect(bounds).toEqual({ x: 800 + half - OPEN / 2, y: 500 + half - OPEN / 2, width: OPEN, height: OPEN });
    expect(ball).toEqual({ x: OPEN / 2, y: OPEN / 2 });
  });
  it("keeps the ball fixed on screen and the window inside the work area near edges", () => {
    for (const h of [{ x: 0, y: 0 }, { x: 1856, y: 1016 }, { x: 0, y: 1016 }, { x: 1000, y: 0 }]) {
      const { bounds, ball } = openBounds(h, area);
      expect({ x: bounds.x + ball.x, y: bounds.y + ball.y }).toEqual(ballOnScreen(h));
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + OPEN).toBeLessThanOrEqual(1920);
      expect(bounds.y + OPEN).toBeLessThanOrEqual(1080);
    }
  });
  it("closes back to the ball-sized window it opened from", () => {
    expect(closedBounds(home)).toEqual({ ...home, width: CLOSED, height: CLOSED });
  });
  it("clamps a dragged ball into the work area", () => {
    const wa = { x: 100, y: 50, width: 1000, height: 600 };
    expect(clampHome({ x: -500, y: -500 }, wa)).toEqual({ x: 100, y: 50 });
    expect(clampHome({ x: 5000, y: 5000 }, wa)).toEqual({ x: 100 + 1000 - CLOSED, y: 50 + 600 - CLOSED });
    expect(clampHome({ x: 300, y: 200 }, wa)).toEqual({ x: 300, y: 200 });
  });
});
