// Widget: transcribe on/off, check selection, check screen, toggle HUD interactive.
import { MicCapture } from "./mic.js";
import type { AudioStatus } from "../../shared/ipc";

const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;
const note = document.getElementById("note")!;
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let clearTimer = 0;
/** One status line. Progress holds until the next message; success and errors clear themselves (errors later). */
const say = (text: string, kind: "info" | "progress" | "error" = "info") => {
  clearTimeout(clearTimer);
  note.textContent = text;
  note.dataset.kind = kind;
  if (!text) return;
  note.animate(
    [{ opacity: 0, transform: calm.matches ? "none" : "translateY(3px)" }, { opacity: 1, transform: "none" }],
    { duration: 200, easing: "cubic-bezier(.22, 1, .36, 1)" });
  if (kind !== "progress") clearTimer = window.setTimeout(() => say(""), kind === "error" ? 5000 : 3000);
};
/** Electron prefixes IPC rejections with "Error invoking remote method '…': Error: "; show only the message. */
const plain = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
const pressed = (b: HTMLButtonElement, on: boolean) => b.setAttribute("aria-pressed", String(on));

/** Disable the button and mark it busy while `fn` runs, so a slow request cannot be sent twice. */
async function busy(b: HTMLButtonElement, fn: () => Promise<void>) {
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  try { await fn(); }
  finally { b.disabled = false; b.removeAttribute("aria-busy"); }
}

const mic = new MicCapture((pcm) => {
  window.inlook.sendAudioFrame(pcm).catch((err: Error) => { if (mic.running) say(`Audio not sent: ${plain(err)}`, "error"); });
});

$("transcribe").onclick = () => busy($("transcribe"), async () => {
  try {
    if (!mic.running) say("Starting mic…", "progress");
    if (mic.running) mic.stop(); else await mic.start();
    await window.inlook.setTranscribing(mic.running);
    say(""); // the toggle shows the state
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

let hudInteractive = false;
$("hud").onclick = () => void window.inlook.setHudInteractive(!hudInteractive);

const MIC_LABEL: Record<AudioStatus, string> = { off: "", connecting: "Connecting", live: "Listening", reconnecting: "Reconnecting" };
const micStatus = document.getElementById("mic-status")!;

// The hotkey runs in main; its outcome arrives here and is shown like a button check.
window.inlook.onCheckResult((r) => {
  if (r.ok) say(r.what === "selection" ? "Selection sent" : "Screenshot sent");
  else say(r.error ?? "Failed", "error");
});

window.inlook.onState((s) => {
  micStatus.dataset.state = s.audio;
  micStatus.textContent = MIC_LABEL[s.audio];
  hudInteractive = s.hudInteractive;
  pressed($("hud"), s.hudInteractive);
  pressed($("transcribe"), s.transcribing);
});
