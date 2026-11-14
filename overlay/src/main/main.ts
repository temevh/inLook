// Main process: owns the windows, the backend client, the SSE stream,
// selection/screenshot reads and the global hotkey.
import { app, BrowserWindow, globalShortcut, ipcMain, session } from "electron";
import { backend } from "./backend-client";
import { config } from "./config";
import { captureScreen } from "./screenshot";
import { readSelection } from "./selection";
import { subscribe } from "./sse";
import { createHud, createWidget, setHudInteractive } from "./windows";
import type { AudioChunk, InlookEvent, ReviewDecision } from "../shared/contract";
import type { IpcInvoke, IpcPush, OverlayState } from "../shared/ipc";

// X11 only (spec "Platform"). Transparency needs a compositor (Mutter or picom).
app.commandLine.appendSwitch("ozone-platform", "x11");
app.commandLine.appendSwitch("enable-transparent-visuals");

const state: OverlayState = { hudInteractive: false, transcribing: false, stream: "connecting" };
let hud: BrowserWindow | undefined;
let widget: BrowserWindow | undefined;

// Events kept for windows that load (or reload) after they arrived.
const BACKLOG_MAX = 200;
const backlog: InlookEvent[] = [];

const windows = () => [hud, widget].filter((w): w is BrowserWindow => !!w && !w.isDestroyed());
const push = (channel: IpcPush, payload: unknown) => windows().forEach((w) => w.webContents.send(channel, payload));
const pushState = () => push("inlook:state", state);

const handle = (channel: IpcInvoke, fn: (...args: any[]) => unknown) =>
  ipcMain.handle(channel, (_e, ...args) => fn(...args));

const attempt = async (fn: () => Promise<unknown>) => {
  try { await fn(); return { ok: true }; }
  catch (err) { console.warn("[inlook]", (err as Error).message); return { ok: false, error: (err as Error).message }; }
};

async function checkSelection() {
  const text = await readSelection();
  if (!text) return { ok: false, error: "No text selected" };
  return attempt(() => backend.postCheck({ kind: "text", text, source: "selection" }));
}

async function checkScreen() {
  return attempt(async () => {
    const png = await captureScreen(windows());
    await backend.postCheck({ kind: "image", mime: "image/png", dataBase64: png.toString("base64"), source: "screenshot" });
  });
}

function registerIpc() {
  handle("state:get", () => state);
  handle("check:selection", checkSelection);
  handle("check:screen", checkScreen);
  handle("hud:set-interactive", (on: boolean) => {
    state.hudInteractive = on;
    if (hud) setHudInteractive(hud, on);
    pushState();
  });
  handle("mic:set-transcribing", (on: boolean) => { state.transcribing = on; pushState(); });
  handle("audio:chunk", (chunk: AudioChunk) => attempt(() => backend.postAudio(chunk)));
  handle("review:decide", (id: string, decision: ReviewDecision) =>
    attempt(() => backend.postReview(id, decision)));
}

app.whenReady().then(() => {
  // Mic permission for our own file:// pages only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) =>
    cb(permission === "media" && wc.getURL().startsWith("file://")));

  registerIpc();
  hud = createHud();
  widget = createWidget();
  for (const w of [hud, widget]) {
    w.webContents.on("did-finish-load", () => {
      w.webContents.send("inlook:state", state);
      for (const e of backlog) w.webContents.send("inlook:event", e);
    });
  }

  subscribe({
    onEvent: (e: InlookEvent) => {
      backlog.push(e);
      if (backlog.length > BACKLOG_MAX) backlog.shift();
      // Windows still loading get the event from the backlog on did-finish-load.
      for (const w of windows()) if (!w.webContents.isLoading()) w.webContents.send("inlook:event", e);
    },
    onStatus: (s) => { state.stream = s; pushState(); },
  });

  // "Check now": the selection if there is one, otherwise the screen.
  const ok = globalShortcut.register(config.checkHotkey, async () => {
    await ((await readSelection()) ? checkSelection() : checkScreen());
  });
  if (!ok) console.warn(`[inlook] hotkey ${config.checkHotkey} is taken`);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
