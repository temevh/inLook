// SSE subscriber for GET /stream, on the `eventsource` package. It reconnects by
// itself and sends Last-Event-ID, so the backend replays what was missed. It gives
// up on some errors (non-200, wrong content type); those get a fresh instance after
// a delay, and we send the Last-Event-ID ourselves since a new instance forgets it.
import { EventSource } from "eventsource";
import { config } from "./config";
import { validateEvent } from "./validate";
import { EVENT_TYPES, type InlookEvent } from "../shared/contract";

export type StreamStatus = "connecting" | "open" | "closed";

export interface StreamOptions {
  onEvent(e: InlookEvent): void;
  onStatus(s: StreamStatus): void;
}

const RECREATE_MS = 3000;

export function subscribe({ onEvent, onStatus }: StreamOptions): () => void {
  let lastEventId: string | undefined;
  let lastSeq = 0;
  let es: EventSource | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const connect = () => {
    onStatus("connecting");
    es = new EventSource(`${config.backendUrl}/stream`, {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (lastEventId) headers.set("last-event-id", lastEventId);
        return fetch(input, { ...init, headers });
      },
    });
    const source = es;
    source.onopen = () => onStatus("open");
    source.onerror = (ev) => {
      if (stopped) return;
      console.warn("[sse]", ev.message ?? "stream error");
      onStatus("closed");
      if (source.readyState === EventSource.CLOSED) timer = setTimeout(connect, RECREATE_MS);
    };
    // Frames carry `event: <type>`, so onmessage never fires; listen per type.
    const onFrame = (m: MessageEvent) => {
      if (m.lastEventId) lastEventId = m.lastEventId;
      let e: unknown;
      try { e = JSON.parse(m.data); } catch (err) { console.warn("[sse] bad json", err); return; }
      const bad = validateEvent(e);
      if (bad) { console.warn("[sse] dropped invalid event:", bad.slice(0, 300)); return; }
      const ev = e as InlookEvent;
      if (ev.seq <= lastSeq) return; // already seen (replay overlap)
      lastSeq = ev.seq;
      onEvent(ev);
    };
    for (const t of EVENT_TYPES) source.addEventListener(t, onFrame);
  };
  connect();

  return () => { stopped = true; clearTimeout(timer); es?.close(); };
}
