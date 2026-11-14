// Widget: transcribe on/off, check selection, check screen, toggle HUD interactive.
import { MicCapture } from "./mic.js";

const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;
const note = document.getElementById("note")!;
const say = (text: string) => { note.textContent = text; };
const pressed = (b: HTMLButtonElement, on: boolean) => b.setAttribute("aria-pressed", String(on));

const mic = new MicCapture(async (chunk) => {
  const r = await window.inlook.sendAudioChunk(chunk);
  if (!r.ok) say(`Audio not sent: ${r.error}`);
});

$("transcribe").onclick = async () => {
  try {
    if (mic.running) mic.stop(); else await mic.start();
    await window.inlook.setTranscribing(mic.running);
    say(mic.running ? "Transcribing" : "");
  } catch (err) {
    say(`Mic unavailable: ${(err as Error).message}`);
  }
};

$("selection").onclick = async () => {
  say("Checking selection…");
  const r = await window.inlook.checkSelection();
  say(r.ok ? "Selection sent" : r.error ?? "Failed");
};

$("screen").onclick = async () => {
  say("Checking screen…");
  const r = await window.inlook.checkScreen();
  say(r.ok ? "Screenshot sent" : r.error ?? "Failed");
};

let hudInteractive = false;
$("hud").onclick = () => void window.inlook.setHudInteractive(!hudInteractive);

window.inlook.onState((s) => {
  hudInteractive = s.hudInteractive;
  pressed($("hud"), s.hudInteractive);
  pressed($("transcribe"), s.transcribing);
});
