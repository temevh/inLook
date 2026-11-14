// On-demand screenshot via desktopCapturer. Only runs when the widget asks.
// STUB: captures the screen under the cursor. Active-window capture (X11
// _NET_ACTIVE_WINDOW → "window:<xid>:0" source id) is not built yet.
import { desktopCapturer, screen, type BrowserWindow } from "electron";

const CAPTURE_TIMEOUT_MS = 5000;

const withTimeout = <T>(p: Promise<T>, ms: number, msg: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

export async function captureScreen(hide: BrowserWindow[] = []): Promise<Buffer> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = display.size;
  const sf = display.scaleFactor;

  // Hide our own windows so the HUD/widget are not in the shot.
  const visible = hide.filter((w) => !w.isDestroyed() && w.isVisible());
  visible.forEach((w) => w.hide());
  await new Promise((r) => setTimeout(r, 150));
  try {
    const sources = await withTimeout(desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
    }), CAPTURE_TIMEOUT_MS, "screen capture timed out");
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) throw new Error("no screen source");
    return source.thumbnail.toPNG();
  } finally {
    visible.forEach((w) => w.showInactive());
  }
}
