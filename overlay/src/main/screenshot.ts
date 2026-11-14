// On-demand screenshot via desktopCapturer. Only runs when the widget asks.
// Captures the whole display under the cursor, downscaled for /check uploads.
import { desktopCapturer, screen, type BrowserWindow } from "electron";

const CAPTURE_TIMEOUT_MS = 5000;
const MAX_SIDE = 1280;
const MAX_AREA = 1.15e6;

const withTimeout = <T>(p: Promise<T>, ms: number, msg: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

export async function captureScreen(hide: BrowserWindow[] = []): Promise<Buffer> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = display.size;
  const sf = display.scaleFactor;

  // Hide our own windows so the HUD/widget are not in the shot. Opacity 0 first: it takes
  // effect at once, while Mutter's hide fade can outlast the wait and ghost into the PNG.
  const visible = hide.filter((w) => !w.isDestroyed() && w.isVisible()).map((w) => ({ w, opacity: w.getOpacity() }));
  visible.forEach(({ w }) => { w.setOpacity(0); w.hide(); });
  await new Promise((r) => setTimeout(r, 150));
  try {
    const sources = await withTimeout(desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) },
    }), CAPTURE_TIMEOUT_MS, "screen capture timed out");
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source) throw new Error("no screen source");
    const img = source.thumbnail;
    const { width: w, height: h } = img.getSize();
    const k = Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
    return (k < 1 ? img.resize({ width: Math.round(w * k), height: Math.round(h * k), quality: "good" }) : img).toPNG();
  } finally {
    for (const { w, opacity } of visible) {
      if (w.isDestroyed()) continue;
      w.setOpacity(opacity);
      w.showInactive();
    }
  }
}
