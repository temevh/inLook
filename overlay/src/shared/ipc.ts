// Types for the preload bridge (window.inlook). Type-only: the sandboxed preload
// cannot load local modules at runtime, so channel names are string literals.
import type { AudioChunk, InlookEvent, ReviewDecision } from "./contract";

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
  sendAudioChunk(chunk: AudioChunk): Promise<{ ok: boolean; error?: string }>;
  // HUD → main
  decideReview(reviewId: string, decision: ReviewDecision): Promise<{ ok: boolean; error?: string }>;
  // main → renderers
  onEvent(cb: (e: InlookEvent) => void): () => void;
  onState(cb: (s: OverlayState) => void): () => void;
  getState(): Promise<OverlayState>;
}

export type IpcInvoke =
  | "check:selection" | "check:screen" | "hud:set-interactive" | "mic:set-transcribing"
  | "audio:chunk" | "review:decide" | "state:get";
export type IpcPush = "inlook:event" | "inlook:state";
