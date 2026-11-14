// Widget: transcribe on/off, check selection, check screen, toggle HUD interactive.
import { MicCapture } from "./mic.js";

const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;
const note = document.getElementById("note")!;
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let clearTimer = 0;
/** One status line. Progress holds until the next message, success clears itself, errors stay until the next action. */
const say = (text: string, kind: "info" | "progress" | "error" = "info") => {
  clearTimeout(clearTimer);
  note.textContent = text;
  note.dataset.kind = kind;
  if (!text) return;
  note.animate(
    [{ opacity: 0, transform: calm.matches ? "none" : "translateY(3px)" }, { opacity: 1, transform: "none" }],
    { duration: 200, easing: "cubic-bezier(.22, 1, .36, 1)" });
  if (kind === "info") clearTimer = window.setTimeout(() => say(""), 3000);
};
const pressed = (b: HTMLButtonElement, on: boolean) => b.setAttribute("aria-pressed", String(on));

/** Disable the button and mark it busy while `fn` runs, so a slow request cannot be sent twice. */
async function busy(b: HTMLButtonElement, fn: () => Promise<void>) {
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  try { await fn(); }
  finally { b.disabled = false; b.removeAttribute("aria-busy"); }
}

const mic = new MicCapture((pcm) => {
  window.inlook.sendAudioFrame(pcm).catch((err: Error) => { if (mic.running) say(`Audio not sent: ${err.message}`, "error"); });
});

$("transcribe").onclick = () => busy($("transcribe"), async () => {
  try {
    if (!mic.running) say("Starting mic…", "progress");
    if (mic.running) mic.stop(); else await mic.start();
    await window.inlook.setTranscribing(mic.running);
    say(""); // the toggle shows the state
  } catch (err) {
    say(`Mic unavailable: ${(err as Error).message}`, "error");
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
      say(`Failed: ${(err as Error).message}`, "error");
    }
  });

$("selection").onclick = () => check($("selection"), "Checking selection…", "Selection sent", () => window.inlook.checkSelection());
$("screen").onclick = () => check($("screen"), "Checking screen…", "Screenshot sent", () => window.inlook.checkScreen());

let hudInteractive = false;
$("hud").onclick = () => void window.inlook.setHudInteractive(!hudInteractive);

window.inlook.onState((s) => {
  hudInteractive = s.hudInteractive;
  pressed($("hud"), s.hudInteractive);
  pressed($("transcribe"), s.transcribing);
});
