// Types for the preload bridge (window.inlook). Type-only: the sandboxed preload
// cannot load local modules at runtime, so channel names are string literals.
import type { InlookEvent, ReviewDecision } from "./contract";

/** Audio WebSocket state: off while not transcribing; reconnecting after a drop or a failed attempt. */
export type AudioStatus = "off" | "connecting" | "live" | "reconnecting";

/** Result of a check that did not start from the widget (the global hotkey). */
export interface CheckResult {
  what: "selection" | "screen";
  ok: boolean;
  error?: string;
}

export interface OverlayState {
  hudInteractive: boolean;
  transcribing: boolean;
  stream: "connecting" | "open" | "closed";
  audio: AudioStatus;
}

export interface InlookBridge {
  // widget → main
  checkSelection(): Promise<{ ok: boolean; error?: string }>;
  checkScreen(): Promise<{ ok: boolean; error?: string }>;
  setHudInteractive(on: boolean): Promise<void>;
  setTranscribing(on: boolean): Promise<void>;
  /** One ~100 ms frame of 16 kHz mono s16le PCM; main forwards it to WS /audio/stream while transcribing. */
  sendAudioFrame(pcm: ArrayBuffer): Promise<void>;
  // HUD → main
  decideReview(reviewId: string, decision: ReviewDecision): Promise<{ ok: boolean; error?: string }>;
  // main → renderers
  onEvent(cb: (e: InlookEvent) => void): () => void;
  onState(cb: (s: OverlayState) => void): () => void;
  /** Outcome of a hotkey check, so the widget can show "sent" or the error. */
  onCheckResult(cb: (r: CheckResult) => void): () => void;
  getState(): Promise<OverlayState>;
}

export type IpcInvoke =
  | "check:selection" | "check:screen" | "hud:set-interactive" | "mic:set-transcribing"
  | "audio:frame" | "review:decide" | "state:get";
export type IpcPush = "inlook:event" | "inlook:state" | "inlook:check-result";
