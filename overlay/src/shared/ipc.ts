// Types for the preload bridge (window.inlook). Type-only: the sandboxed preload
// cannot load local modules at runtime, so channel names are string literals.
import type { InlookEvent, ReviewRequest } from "./contract.gen";

export type StreamStatus = "connecting" | "open" | "closed";

/** Audio WebSocket state: off while not transcribing; reconnecting after a drop or a failed attempt. */
export type AudioStatus = "off" | "connecting" | "live" | "reconnecting";

/** Result of a check that did not start from the widget (the global hotkey). */
export interface CheckResult {
  what: "selection" | "screen";
  ok: boolean;
  error?: string;
}

/** Global hotkeys as Electron accelerators ("CommandOrControl+Alt+A"); "" when the key could not be registered. */
export interface Hotkeys { check: string; accept: string; reject: string }

export interface OverlayState {
  transcribing: boolean;
  stream: StreamStatus;
  audio: AudioStatus;
  hotkeys: Hotkeys;
}

/** Open navball window: its side length and where the ball centre sits inside it. */
export interface BallLayout { x: number; y: number; size: number }

export interface InlookBridge {
  // widget → main
  /** Grow the widget window around the ball (returns the layout) or shrink it back (null). */
  setBubblesOpen(open: boolean): Promise<BallLayout | null>;
  /** Drag begins: main collapses the bubbles if open and resolves true if it did. */
  dragStart(): Promise<boolean>;
  /** Pointer travel since dragStart in screen px; main moves the window, clamped to the work area. */
  dragMove(dx: number, dy: number): Promise<void>;
  checkSelection(): Promise<{ ok: boolean; error?: string }>;
  checkScreen(): Promise<{ ok: boolean; error?: string }>;
  setTranscribing(on: boolean): Promise<void>;
  /** Quit the whole app. */
  quit(): Promise<void>;
  /** One ~100 ms frame of 16 kHz mono s16le PCM; main forwards it to WS /audio/stream while transcribing. */
  sendAudioFrame(pcm: ArrayBuffer): Promise<void>;
  // HUD → main
  decideReview(reviewId: string, decision: ReviewRequest["decision"]): Promise<{ ok: boolean; error?: string }>;
  /** Height in px, from the top of the strip, that the HUD currently draws on (0 = nothing). Main makes exactly
   *  that part of the window clickable; the rest stays click-through. */
  setHudExtent(height: number): Promise<void>;
  // main → renderers
  onEvent(cb: (e: InlookEvent) => void): () => void;
  onState(cb: (s: OverlayState) => void): () => void;
  /** Outcome of a hotkey check, so the widget can show "sent" or the error. */
  onCheckResult(cb: (r: CheckResult) => void): () => void;
  /** The accept / reject hotkey was pressed: the HUD decides its newest pending review. */
  onDecide(cb: (decision: ReviewRequest["decision"]) => void): () => void;
  /** Mic level 0..1 (about 10 per second while transcribing), for the HUD's listening meter. */
  onLevel(cb: (level: number) => void): () => void;
  getState(): Promise<OverlayState>;
}

export type IpcInvoke =
  | "check:selection" | "check:screen" | "hud:set-extent" | "mic:set-transcribing"
  | "audio:frame" | "review:decide" | "state:get"
  | "app:quit" | "widget:set-open" | "widget:drag-start" | "widget:drag-move";
export type IpcPush = "inlook:event" | "inlook:state" | "inlook:check-result" | "inlook:decide" | "inlook:level";
