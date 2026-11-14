// One EventSource on /stream. Frames carry `id: <bootId>:<seq>`; a new boot id means the
// backend restarted (or reseeded), so the store reloads its snapshot.
import type { Connection, InlookEvent } from "../types";

export interface StreamHandlers {
  onEvent: (e: InlookEvent, bootId: string | null) => void;
  onConnection: (c: Connection) => void;
}

const OFFLINE_AFTER_MS = 10_000;

export function openStream(h: StreamHandlers): () => void {
  const es = new EventSource("/stream");
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  h.onConnection("connecting");
  es.onopen = () => {
    clearTimeout(offlineTimer);
    offlineTimer = undefined;
    h.onConnection("live");
  };
  es.onerror = () => {
    h.onConnection("reconnecting");
    offlineTimer ??= setTimeout(() => h.onConnection("offline"), OFFLINE_AFTER_MS);
  };
  es.onmessage = (m) => {
    let e: InlookEvent;
    try { e = JSON.parse(m.data); } catch { return; }
    const bootId = m.lastEventId.includes(":") ? m.lastEventId.split(":")[0] : null;
    h.onEvent(e, bootId);
  };
  return () => { clearTimeout(offlineTimer); es.close(); };
}
