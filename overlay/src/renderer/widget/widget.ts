// Navball: one draggable ball; click it to fan out the bubbles (transcribe, check selection, check screen, close).
// While the mic is on, a ring around the ball follows the voice level.
import { fanSlots, isDrag } from "./ball.js";
import { MicCapture } from "./mic.js";
import type { AudioStatus } from "../../shared/ipc";

const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;
const root = $("navball"), ball = $("ball"), note = $("note"), badge = $("badge");
const quit = $("quit"), CONFIRM = "Confirm close?";
const bubbles = [...document.querySelectorAll<HTMLButtonElement>(".bubble")];
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const CLOSED_AT = "32px"; // ball centre in the closed 64 px window; matches the CSS default

let open = false, autoOpened = false;
let msg: { text: string; kind: "info" | "progress" | "error" } = { text: "", kind: "info" };
let hinted: HTMLElement | undefined, confirmTimer = 0, audio: AudioStatus = "off";
let clearTimer = 0;

const MIC_LABEL: Record<AudioStatus, string> = { off: "", connecting: "Connecting", live: "Listening", reconnecting: "Reconnecting" };
const MIC_BADGE: Record<AudioStatus, string> = { off: "", connecting: "wait", live: "live", reconnecting: "wait" };

/** Label (open only) and ball badge (always): latest message, else the hovered bubble's name, else the mic state. */
function render() {
  const text = quit.dataset.confirm ? CONFIRM : msg.text || hinted?.getAttribute("aria-label") || MIC_LABEL[audio];
  if (text !== note.textContent) {
    note.textContent = text;
    if (text && !calm.matches) note.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.22, 1, .36, 1)" });
  }
  note.hidden = !text;
  note.dataset.kind = msg.text ? msg.kind : "info";
  const state = msg.text ? { info: "", progress: "wait", error: "error" }[msg.kind] || "info" : MIC_BADGE[audio];
  badge.hidden = !state;
  badge.dataset.state = state;
  ball.setAttribute("aria-label", text ? `inLook menu: ${text}` : "inLook menu");
}

/** One status line. Progress holds until the next message; success and errors clear themselves (errors later). */
const say = (text: string, kind: "info" | "progress" | "error" = "info") => {
  clearTimeout(clearTimer);
  msg = { text, kind };
  render();
  if (!text) { if (autoOpened) setOpen(false); return; }
  // The label only shows while open, so an error opens the bubbles by itself and closes them again when it clears.
  if (kind === "error" && !open) setOpen(true, true);
  if (kind !== "progress") clearTimer = window.setTimeout(() => say(""), kind === "error" ? 5000 : 3000);
};
/** Electron prefixes IPC rejections with "Error invoking remote method '…': Error: "; show only the message. */
const plain = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
const pressed = (b: HTMLButtonElement, on: boolean) => b.setAttribute("aria-pressed", String(on));

// Window resizes, opens, closes and drag starts run one at a time, in the order they were asked.
let op: Promise<unknown> = Promise.resolve();
const serial = (fn: () => Promise<void>) => (op = op.then(fn).catch((err) => say(`Widget: ${plain(err)}`, "error")));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bubbles hidden, ball back at the closed-window centre. */
function showClosed() {
  root.dataset.open = "false";
  ball.setAttribute("aria-expanded", "false");
  hinted = undefined;
  setConfirm(false); // closing the navball, or starting a drag, disarms the close bubble
  render();
}
function resetBall() {
  root.style.setProperty("--bx", CLOSED_AT);
  root.style.setProperty("--by", CLOSED_AT);
}

async function openUi() {
  const layout = await window.inlook.setBubblesOpen(true);
  if (!layout) return;
  root.style.setProperty("--bx", `${layout.x}px`);
  root.style.setProperty("--by", `${layout.y}px`);
  const slots = fanSlots(layout, layout.size, bubbles.length);
  bubbles.forEach((b, i) => {
    b.style.setProperty("--dx", `${slots[i]?.x ?? 0}px`);
    b.style.setProperty("--dy", `${slots[i]?.y ?? 0}px`);
    b.style.setProperty("--i", String(i));
  });
  note.dataset.side = layout.y > layout.size / 2 ? "top" : "bottom";
  root.dataset.open = "true";
  ball.setAttribute("aria-expanded", "true");
}
async function closeUi() {
  showClosed();
  if (!calm.matches) await wait(260); // let the bubbles fold in before the window shrinks
  await window.inlook.setBubblesOpen(false);
  resetBall();
}
const setOpen = (on: boolean, auto = false) => {
  if (on === open) return;
  open = on;
  autoOpened = on && auto;
  void serial(on ? openUi : closeUi);
};

// Ball: a press that moves past a few px drags the window; otherwise it is a click that toggles the bubbles.
let press: { x: number; y: number; moved: boolean; ready?: Promise<unknown> } | undefined;
ball.onpointerdown = (e) => {
  if (e.button !== 0) return;
  ball.setPointerCapture(e.pointerId);
  press = { x: e.screenX, y: e.screenY, moved: false };
};
ball.onpointermove = (e) => {
  if (!press) return;
  const dx = e.screenX - press.x, dy = e.screenY - press.y; // screen coords: stay right while the window moves under the pointer
  if (!press.moved) {
    if (!isDrag(dx, dy)) return;
    press.moved = true;
    open = false; autoOpened = false;
    press.ready = serial(async () => {
      if (await window.inlook.dragStart()) { showClosed(); resetBall(); } // main already shrank the window
    });
  }
  void press.ready?.then(() => window.inlook.dragMove(dx, dy)).catch(() => {});
};
ball.onpointerup = () => {
  const moved = press?.moved;
  if (press && !moved) { autoOpened = false; setOpen(!open); }
  press = undefined;
};
ball.onpointercancel = () => { press = undefined; };
ball.onclick = (e) => { if (e.detail === 0) { autoOpened = false; setOpen(!open); } }; // keyboard Enter/Space

// Hovering or focusing a bubble shows its name in the label (the tooltip).
for (const b of bubbles) {
  const on = () => { hinted = b; render(); };
  const off = () => { hinted = undefined; render(); };
  b.onpointerenter = on; b.onfocus = on; b.onpointerleave = off; b.onblur = off;
}

/** Disable the button and mark it busy while `fn` runs, so a slow request cannot be sent twice. */
async function busy(b: HTMLButtonElement, fn: () => Promise<void>) {
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  try { await fn(); }
  finally { b.disabled = false; b.removeAttribute("aria-busy"); }
}

/** Loudness of a PCM s16le frame as 0..1 (-50 dBFS and below = 0, -10 dBFS and above = 1). */
function levelOf(pcm: ArrayBuffer) {
  const samples = new Int16Array(pcm, 0, pcm.byteLength >> 1);
  let sum = 0;
  for (const v of samples) sum += v * v;
  const db = 20 * Math.log10(Math.sqrt(sum / Math.max(1, samples.length)) / 32768 || 1e-6);
  return Math.max(0, Math.min(1, (db + 50) / 40));
}

const mic = new MicCapture((pcm) => {
  root.style.setProperty("--level", levelOf(pcm).toFixed(2)); // before the buffer is handed to IPC
  window.inlook.sendAudioFrame(pcm).catch((err: Error) => { if (mic.running) say(`Audio not sent: ${plain(err)}`, "error"); });
});

$("transcribe").onclick = () => busy($("transcribe"), async () => {
  try {
    if (!mic.running) say("Starting mic…", "progress");
    if (mic.running) mic.stop(); else await mic.start();
    await window.inlook.setTranscribing(mic.running);
    say(""); // the bubble shows the state
  } catch (err) {
    say(`Mic unavailable: ${plain(err)}`, "error");
  }
});

/** Run a check request: progress while it runs, then sent or the error. */
const check = (b: HTMLButtonElement, progress: string, done: string, call: () => Promise<{ ok: boolean; error?: string }>) =>
  busy(b, async () => {
    say(progress, "progress");
    try {
      const r = await call();
      if (r.ok) say(done); else say(r.error ?? "Failed", "error");
    } catch (err) {
      say(`Failed: ${plain(err)}`, "error");
    }
  });

$("selection").onclick = () => check($("selection"), "Checking selection…", "Selection sent", () => window.inlook.checkSelection());
$("screen").onclick = () => check($("screen"), "Checking screen…", "Screenshot sent", () => window.inlook.checkScreen());

// Close: the first click arms it (red, "Confirm close?"); a second click quits. Any other click or ~3 s disarms it.
function setConfirm(on: boolean) {
  clearTimeout(confirmTimer);
  if (on) { quit.dataset.confirm = "true"; confirmTimer = window.setTimeout(() => setConfirm(false), 3000); }
  else delete quit.dataset.confirm;
  quit.setAttribute("aria-label", on ? CONFIRM : "Close");
  render();
}
quit.onclick = () => { if (quit.dataset.confirm) void window.inlook.quit(); else setConfirm(true); };
document.addEventListener("pointerdown", (e) => { if (!quit.contains(e.target as Node)) setConfirm(false); }, true);

// The hotkey runs in main; its outcome arrives here and is shown like a button check.
window.inlook.onCheckResult((r) => {
  if (r.ok) say(r.what === "selection" ? "Selection sent" : "Screenshot sent");
  else say(r.error ?? "Failed", "error");
});

window.inlook.onState((s) => {
  audio = s.audio;
  render();
  pressed($("transcribe"), s.transcribing);
  root.dataset.listening = String(s.transcribing && s.audio === "live");
  if (!s.transcribing) root.style.setProperty("--level", "0");
});
