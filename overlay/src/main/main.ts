// Main process: owns the windows, the backend client, the SSE stream,
// selection/screenshot reads and the global hotkey.
import { app, BrowserWindow, globalShortcut, ipcMain, session } from "electron";
import { audioStream } from "./audio-stream";
import { backend } from "./backend-client";
import { config } from "./config";
import { captureScreen } from "./screenshot";
import { readSelection } from "./selection";
import { subscribe } from "./sse";
import { createNavball } from "./navball";
import { createHud, createWidget, isOwnPage, setHudInteractive } from "./windows";
import type { InlookEvent, ReviewRequest } from "../shared/contract.gen";
import type { CheckResult, IpcInvoke, IpcPush, OverlayState } from "../shared/ipc";

const state: OverlayState = { hudInteractive: false, transcribing: false, stream: "connecting", audio: "off" };
let hud: BrowserWindow | undefined;
let widget: BrowserWindow | undefined;
let navball: ReturnType<typeof createNavball> | undefined;

// Events kept for windows that load (or reload) after they arrived.
const BACKLOG_MAX = 200;
const backlog: InlookEvent[] = [];

const windows = () => [hud, widget].filter((w): w is BrowserWindow => !!w && !w.isDestroyed());
const push = (channel: IpcPush, payload: unknown) => windows().forEach((w) => w.webContents.send(channel, payload));
const pushState = () => push("inlook:state", state);

// Only our two local pages may call; arguments are validated by each handler's guard.
const handle = (channel: IpcInvoke, fn: (...args: any[]) => unknown) =>
  ipcMain.handle(channel, (e, ...args) => {
    if (!isOwnPage(e.senderFrame?.url)) throw new Error(`IPC ${channel} rejected: unknown sender`);
    return fn(...args);
  });

const AUDIO_FRAME_MAX_BYTES = 64 * 1024; // a frame is ~100 ms = 3200 B; leave headroom
const bad = (what: string): never => { throw new Error(`invalid ${what}`); };
const asBool = (v: unknown) => (typeof v === "boolean" ? v : bad("boolean"));
const DRAG_MAX_PX = 20000; // far beyond any screen; rejects garbage
const asDelta = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= DRAG_MAX_PX ? v : bad("drag delta"));
const asReviewId = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : bad("review id"));
const asDecision = (v: unknown): ReviewRequest["decision"] => (v === "accept" || v === "reject" ? v : bad("decision"));
function asAudioFrame(v: unknown): ArrayBuffer {
  if (!(v instanceof ArrayBuffer) || v.byteLength === 0 || v.byteLength > AUDIO_FRAME_MAX_BYTES) return bad("audio frame");
  return v;
}

const attempt = async (fn: () => Promise<unknown>) => {
  try { await fn(); return { ok: true }; }
  catch (err) { console.warn("[inlook]", (err as Error).message); return { ok: false, error: (err as Error).message }; }
};

async function checkSelection(text?: string) {
  text ??= await readSelection();
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
  handle("check:selection", () => checkSelection());
  handle("check:screen", checkScreen);
  handle("hud:set-interactive", (v: unknown) => {
    const on = asBool(v);
    state.hudInteractive = on;
    if (hud) setHudInteractive(hud, on);
    pushState();
  });
  handle("mic:set-transcribing", (v: unknown) => {
    state.transcribing = asBool(v);
    if (state.transcribing) audioStream.start(); else audioStream.stop();
    pushState();
  });
  handle("app:quit", () => { app.quit(); });
  handle("widget:set-open", (v: unknown) => navball?.setOpen(asBool(v)) ?? null);
  handle("widget:drag-start", () => navball?.dragStart() ?? false);
  handle("widget:drag-move", (dx: unknown, dy: unknown) => { navball?.dragMove(asDelta(dx), asDelta(dy)); });
  handle("audio:frame", (v: unknown) => { audioStream.send(asAudioFrame(v)); });
  handle("review:decide", (id: unknown, decision: unknown) => {
    const reviewId = asReviewId(id), d = asDecision(decision);
    return attempt(() => backend.postReview(reviewId, d));
  });
}

// One instance only: a second launch quits and brings the existing widget back.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => {
  if (!widget || widget.isDestroyed()) return;
  if (widget.isMinimized()) widget.restore();
  widget.showInactive();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // Mic permission for our own pages only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(permission === "media" && isOwnPage(details.requestingUrl ?? wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) =>
    permission === "media" && isOwnPage(details.requestingUrl ?? wc?.getURL()));

  audioStream.onStatus((s) => { state.audio = s; pushState(); });
  registerIpc();
  hud = createHud();
  widget = createWidget();
  navball = createNavball(widget);
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
  // The result goes to the widget, like the button path, so it shows "sent" or the error.
  const ok = globalShortcut.register(config.checkHotkey, async () => {
    const text = await readSelection();
    const what = text ? "selection" : "screen";
    const r = await (text ? checkSelection(text) : checkScreen());
    const result: CheckResult = { what, ...r };
    if (widget && !widget.isDestroyed()) widget.webContents.send("inlook:check-result" satisfies IpcPush, result);
  });
  if (!ok) console.warn(`[inlook] hotkey ${config.checkHotkey} is taken`);
});

app.on("will-quit", () => { globalShortcut.unregisterAll(); audioStream.stop(); });
app.on("window-all-closed", () => app.quit());
