// SSE subscriber for GET /stream, on the `eventsource` package. It reconnects by
// itself and sends Last-Event-ID, so the backend replays what was missed. It gives
// up on some errors (non-200, wrong content type); those get a fresh instance after
// a delay, and we send the Last-Event-ID ourselves since a new instance forgets it.
// Frames carry no `event:` line (the type is in the envelope), so onmessage gets all.
import { EventSource } from "eventsource";
import { config } from "./config";
import { validateEvent } from "./validate";
import type { InlookEvent } from "../shared/contract.gen";
import type { StreamStatus } from "../shared/ipc";

export interface StreamOptions {
  onEvent(e: InlookEvent): void;
  onStatus(s: StreamStatus): void;
}

const RECREATE_MS = 3000;

export function subscribe({ onEvent, onStatus }: StreamOptions): () => void {
  let lastEventId: string | undefined;
  let lastSeq = 0;
  let lastBoot = "";
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
    source.onmessage = (m) => {
      if (m.lastEventId) lastEventId = m.lastEventId;
      let e: unknown;
      try { e = JSON.parse(m.data); } catch (err) { console.warn("[sse] bad json", err); return; }
      const bad = validateEvent(e);
      if (bad) { console.warn("[sse] dropped invalid event:", bad.slice(0, 300)); return; }
      const ev = e as InlookEvent;
      // Ids are `<bootId>:<seq>`. A new boot id means the backend restarted and seq began
      // again at 1, so the seq de-dupe only holds within one boot id.
      const boot = m.lastEventId.slice(0, m.lastEventId.lastIndexOf(":") + 1);
      if (boot !== lastBoot) { lastBoot = boot; lastSeq = 0; }
      if (ev.seq <= lastSeq) return; // already seen (replay overlap)
      lastSeq = ev.seq;
      onEvent(ev);
    };
  };
  connect();

  return () => { stopped = true; clearTimeout(timer); es?.close(); };
}
