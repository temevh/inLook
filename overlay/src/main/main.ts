// Main process: owns the windows, the backend client, the SSE stream,
// selection/screenshot reads and the global hotkey.
import { app, BrowserWindow, globalShortcut, ipcMain, session } from "electron";
import { backend } from "./backend-client";
import { config } from "./config";
import { captureScreen } from "./screenshot";
import { readSelection } from "./selection";
import { subscribe } from "./sse";
import { createHud, createWidget, isOwnPage, setHudInteractive } from "./windows";
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

// Only our two local pages may call; arguments are validated by each handler's guard.
const handle = (channel: IpcInvoke, fn: (...args: any[]) => unknown) =>
  ipcMain.handle(channel, (e, ...args) => {
    if (!isOwnPage(e.senderFrame?.url)) throw new Error(`IPC ${channel} rejected: unknown sender`);
    return fn(...args);
  });

const AUDIO_CHUNK_MAX_BYTES = 4 * 1024 * 1024; // ~10 s Opus is well under 1 MB
const bad = (what: string): never => { throw new Error(`invalid ${what}`); };
const asBool = (v: unknown) => (typeof v === "boolean" ? v : bad("boolean"));
const asReviewId = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : bad("review id"));
const asDecision = (v: unknown): ReviewDecision => (v === "accept" || v === "reject" ? v : bad("decision"));
function asAudioChunk(v: unknown): AudioChunk {
  const c = v as Partial<AudioChunk> | null;
  if (!c || typeof c !== "object") return bad("audio chunk");
  if (!(c.data instanceof ArrayBuffer) || c.data.byteLength === 0 || c.data.byteLength > AUDIO_CHUNK_MAX_BYTES) bad("audio data");
  if (typeof c.mime !== "string" || !c.mime.startsWith("audio/") || c.mime.length > 100) bad("audio mime");
  if (typeof c.startedAt !== "string" || c.startedAt.length > 100) bad("audio startedAt");
  if (!Number.isInteger(c.seqNo) || (c.seqNo as number) < 0) bad("audio seqNo");
  return c as AudioChunk;
}

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
  handle("hud:set-interactive", (v: unknown) => {
    const on = asBool(v);
    state.hudInteractive = on;
    if (hud) setHudInteractive(hud, on);
    pushState();
  });
  handle("mic:set-transcribing", (v: unknown) => { state.transcribing = asBool(v); pushState(); });
  handle("audio:chunk", (v: unknown) => { const chunk = asAudioChunk(v); return attempt(() => backend.postAudio(chunk)); });
  handle("review:decide", (id: unknown, decision: unknown) => {
    const reviewId = asReviewId(id), d = asDecision(decision);
    return attempt(() => backend.postReview(reviewId, d));
  });
}

app.whenReady().then(() => {
  // Mic permission for our own pages only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) =>
    cb(permission === "media" && isOwnPage(details.requestingUrl ?? wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) =>
    permission === "media" && isOwnPage(details.requestingUrl ?? wc?.getURL()));

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
