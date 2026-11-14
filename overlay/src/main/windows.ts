// HUD and widget windows, flags from the spec ("Overlay app (Electron)").
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config";
import { CLOSED, OPEN } from "./geometry";

const preload = join(__dirname, "..", "preload", "preload.js");
// Renderer output lives in dist/web (ES modules), apart from the CommonJS main build.
const page = (name: string) => join(__dirname, "..", "web", "renderer", name, "index.html");

const pageUrls = new Set(["hud", "widget"].map((name) => pathToFileURL(page(name)).href));
/** True only for our two local pages: the sole callers allowed for IPC and media permission. */
export const isOwnPage = (url: string | undefined): boolean => !!url && pageUrls.has(url);

/** No new windows, no navigation away from the local page. */
function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

const webPreferences = { preload, contextIsolation: true, sandbox: true, nodeIntegration: false };

/** Transparent, frameless, always-on-top side strip. Click-through until it draws something (setHudExtent). */
export function createHud(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = config.hudWidth;
  const hud = new BrowserWindow({
    x: config.hudEdge === "right" ? workArea.x + workArea.width - width : workArea.x,
    y: workArea.y,
    width,
    height: workArea.height,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences,
  });
  lockDown(hud);
  hud.setAlwaysOnTop(true, "screen-saver");
  hud.setVisibleOnAllWorkspaces(true);
  // Click-through while empty; setHudExtent opens up exactly the part that shows something.
  hud.setIgnoreMouseEvents(true);
  hud.once("ready-to-show", () => hud.showInactive());
  void hud.loadFile(page("hud"));
  return hud;
}

const SHRINK_DELAY_MS = 500; // let exit and glide animations finish inside the old shape before it shrinks

/** Make the top `height` px of the HUD (what it currently draws on) receive the mouse, and leave the rest
 *  click-through: clicks below the last card reach the app underneath, with no mode to switch.
 *  Uses the X11 window shape (setShape), which also limits where the window draws; the HUD itself is never
 *  moved or resized. Growing applies at once, shrinking after a moment. Returns the setter. */
export function hudExtentSetter(hud: BrowserWindow): (height: number) => void {
  let applied = 0, timer: NodeJS.Timeout | undefined;
  const apply = (height: number) => {
    if (hud.isDestroyed()) return;
    applied = height;
    const [width = 0] = hud.getSize();
    if (height <= 0) {
      hud.setIgnoreMouseEvents(true);
      hud.setShape([{ x: 0, y: 0, width: 1, height: 1 }]); // an empty list would mean "whole window"
    } else {
      hud.setShape([{ x: 0, y: 0, width, height }]);
      hud.setIgnoreMouseEvents(false);
    }
  };
  return (height: number) => {
    const [, max = 0] = hud.isDestroyed() ? [] : hud.getSize();
    const h = Math.max(0, Math.min(Math.ceil(height), max));
    clearTimeout(timer);
    if (h === applied) return;
    if (h > applied) apply(h);
    else timer = setTimeout(() => apply(h), SHRINK_DELAY_MS);
  };
}

/** Navball window: transparent, frameless, always on top, as small as the ball (main/navball.ts resizes it). */
export function createWidget(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 16;
  // Far enough from the HUD that the opened fan (a square of OPEN px around the ball) does not cover it.
  const clear = margin + (OPEN - CLOSED) / 2;
  const x = config.hudEdge === "right"
    ? workArea.x + workArea.width - config.hudWidth - CLOSED - clear
    : workArea.x + config.hudWidth + clear;
  const widget = new BrowserWindow({
    x, y: workArea.y + workArea.height - CLOSED - margin,
    width: CLOSED, height: CLOSED,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Not focusable (like the HUD): clicks still reach the buttons, but GNOME's
    // focus-stealing prevention no longer raises "'inLook widget' is ready" on show.
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences,
  });
  lockDown(widget);
  widget.setAlwaysOnTop(true, "screen-saver");
  widget.setVisibleOnAllWorkspaces(true);
  widget.once("ready-to-show", () => widget.showInactive());
  void widget.loadFile(page("widget"));
  return widget;
}
