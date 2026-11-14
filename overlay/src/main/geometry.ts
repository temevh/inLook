// Navball window geometry (pure, no Electron): the closed window is just the ball,
// the open one is a square around it. The ball keeps its screen position across both.
export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const CLOSED = 64; // ball (56) + 4 px margin
export const OPEN = 248; // fan ring (80 + 20) + room for the status label, per side

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const clampPos = (p: Point, size: number, area: Rect): Point => ({
  x: clamp(p.x, area.x, area.x + area.width - size),
  y: clamp(p.y, area.y, area.y + area.height - size),
});

/** Keep a closed window (home = its top-left) fully inside the work area. */
export const clampHome = (home: Point, area: Rect): Point => clampPos(home, CLOSED, area);

export const closedBounds = (home: Point): Rect => ({ ...home, width: CLOSED, height: CLOSED });

/** Open window around the ball, shifted into the work area if the ball sits near an edge.
 *  `ball` is the ball centre inside the window; the renderer fans the bubbles away from the edge. */
export function openBounds(home: Point, area: Rect): { bounds: Rect; ball: Point } {
  const cx = home.x + CLOSED / 2, cy = home.y + CLOSED / 2;
  const p = clampPos({ x: Math.round(cx - OPEN / 2), y: Math.round(cy - OPEN / 2) }, OPEN, area);
  return { bounds: { ...p, width: OPEN, height: OPEN }, ball: { x: cx - p.x, y: cy - p.y } };
}
