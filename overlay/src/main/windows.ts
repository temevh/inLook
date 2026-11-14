// HUD and widget windows, flags from the spec ("Overlay app (Electron)").
import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config";

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

/** Transparent, frameless, always-on-top side strip. Click-through by default. */
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
  // Fully click-through. On Linux { forward: true } does not work, so hover cannot wake it.
  hud.setIgnoreMouseEvents(true);
  hud.once("ready-to-show", () => hud.showInactive());
  void hud.loadFile(page("hud"));
  return hud;
}

/** Switch the HUD between click-through and accepting clicks (review accept/reject). */
export function setHudInteractive(hud: BrowserWindow, on: boolean): void {
  hud.setIgnoreMouseEvents(!on);
  hud.setFocusable(on);
  if (on) hud.focus();
}

/** Small always-on-top control window, normal mouse input, slight opacity. */
export function createWidget(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 252, height = 264, margin = 16;
  const x = config.hudEdge === "right"
    ? workArea.x + workArea.width - config.hudWidth - width - margin
    : workArea.x + config.hudWidth + margin;
  const widget = new BrowserWindow({
    x, y: workArea.y + workArea.height - height - margin,
    width, height,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Not focusable (like the HUD): clicks still reach the buttons, but GNOME's
    // focus-stealing prevention no longer raises "'inLook widget' is ready" on show.
    focusable: false,
    alwaysOnTop: true,
    opacity: 0.92,
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
