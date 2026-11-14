// Mic audio to the backend: one WebSocket (WS /audio/stream) per transcribing
// session, carrying binary frames of 16 kHz mono s16le PCM (~100 ms each).
// Uses Node's built-in WebSocket. Frames are dropped while the socket is not
// open; if it drops mid-session it reconnects after a short delay (a new
// connection is a new session for the backend).
import { config } from "./config";
import type { AudioStatus } from "../shared/ipc";

const RECONNECT_MS = 1000;
const MAX_BUFFERED_BYTES = 320_000; // ~10 s of audio; beyond that the link is stalled, drop frames

let ws: WebSocket | undefined;
let active = false;
let retry: NodeJS.Timeout | undefined;
let status: AudioStatus = "off";
let listener: ((s: AudioStatus) => void) | undefined;

function setStatus(s: AudioStatus) {
  if (s === status) return;
  status = s;
  listener?.(s);
}

const url = () => `${config.backendUrl.replace(/^http/, "ws")}/audio/stream`;

function connect() {
  if (!active || ws) return;
  const sock = new WebSocket(url());
  ws = sock;
  const lost = () => {
    if (ws !== sock) return; // already replaced or stopped
    ws = undefined;
    if (active) {
      setStatus("reconnecting");
      retry = setTimeout(connect, RECONNECT_MS);
    }
  };
  sock.addEventListener("open", () => {
    if (ws !== sock) return;
    console.log("[inlook] audio stream open");
    setStatus("live");
  });
  sock.addEventListener("error", () => console.warn("[inlook] audio stream error"));
  sock.addEventListener("close", lost);
}

export const audioStream = {
  /** Current state: connecting / live / reconnecting while transcribing, off otherwise. */
  get status(): AudioStatus { return status; },

  /** Called on every state change (one listener). */
  onStatus(cb: (s: AudioStatus) => void) { listener = cb; },

  /** Transcribing started: open the session. */
  start() {
    if (active) return;
    active = true;
    setStatus("connecting");
    connect();
  },

  /** Transcribing stopped: close the session and stop reconnecting. */
  stop() {
    active = false;
    clearTimeout(retry);
    const sock = ws;
    ws = undefined;
    if (sock && sock.readyState <= WebSocket.OPEN) sock.close(1000);
    setStatus("off");
  },

  /** One PCM frame; dropped unless the socket is open. */
  send(pcm: ArrayBuffer) {
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(pcm);
  },
};
