// Navball window controller: drag by renderer-sent deltas and grow/shrink around the ball.
import { screen, type BrowserWindow } from "electron";
import { clampHome, closedBounds, CLOSED, OPEN, openBounds, type Point } from "./geometry";
import type { BallLayout } from "../shared/ipc";

export function createNavball(win: BrowserWindow) {
  const [x, y] = win.getPosition();
  let home: Point = { x: x ?? 0, y: y ?? 0 }; // top-left of the closed window; authoritative, never read back from X11
  let origin = home;
  let layout: BallLayout | null = null;
  const areaAt = (p: Point) => screen.getDisplayNearestPoint({ x: p.x + CLOSED / 2, y: p.y + CLOSED / 2 }).workArea;

  /** Open: grow around the ball and return where the ball sits in the window. Close: shrink back to the ball. */
  function setOpen(on: boolean): BallLayout | null {
    if (win.isDestroyed()) return null;
    if (on && !layout) {
      const { bounds, ball } = openBounds(home, areaAt(home));
      win.setBounds(bounds);
      layout = { ...ball, size: OPEN };
    } else if (!on && layout) {
      win.setBounds(closedBounds(home));
      layout = null;
    }
    return layout;
  }

  return {
    setOpen,
    /** Start of a drag: collapse the bubbles (ball stays put) and remember where the drag began. Returns true if it collapsed. */
    dragStart(): boolean {
      const wasOpen = !!layout;
      setOpen(false);
      origin = home;
      return wasOpen;
    },
    /** dx, dy: pointer travel since dragStart, in screen px. */
    dragMove(dx: number, dy: number): void {
      if (win.isDestroyed() || layout) return;
      home = clampHome({ x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) }, areaAt({ x: origin.x + dx, y: origin.y + dy }));
      win.setPosition(home.x, home.y);
    },
  };
}
