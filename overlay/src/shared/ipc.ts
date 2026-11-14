// Types for the preload bridge (window.inlook). Type-only: the sandboxed preload
// cannot load local modules at runtime, so channel names are string literals.
import type { InlookEvent, ReviewDecision } from "./contract";

export interface OverlayState {
  hudInteractive: boolean;
  transcribing: boolean;
  stream: "connecting" | "open" | "closed";
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
  getState(): Promise<OverlayState>;
}

export type IpcInvoke =
  | "check:selection" | "check:screen" | "hud:set-interactive" | "mic:set-transcribing"
  | "audio:frame" | "review:decide" | "state:get";
export type IpcPush = "inlook:event" | "inlook:state";
