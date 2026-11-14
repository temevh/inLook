// SSE subscriber for GET /stream. Tracks the last seq and sends it as
// Last-Event-ID on reconnect, so the backend replays what was missed.
import { config } from "./config";
import { EVENT_TYPES, type InlookEvent } from "../shared/contract";

export type StreamStatus = "connecting" | "open" | "closed";

export interface StreamOptions {
  onEvent(e: InlookEvent): void;
  onStatus(s: StreamStatus): void;
}

const KNOWN = new Set<string>(EVENT_TYPES);

export function subscribe({ onEvent, onStatus }: StreamOptions): () => void {
  let lastEventId: string | undefined;
  let lastSeq = 0;
  let retryMs = 1000;
  let stopped = false;
  let controller: AbortController | undefined;

  const connect = async () => {
    while (!stopped) {
      controller = new AbortController();
      onStatus("connecting");
      try {
        const headers: Record<string, string> = { accept: "text/event-stream" };
        if (lastEventId) headers["last-event-id"] = lastEventId;
        const res = await fetch(`${config.backendUrl}/stream`, { headers, signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onStatus("open");
        retryMs = 1000;
        await readFrames(res.body, (frame) => {
          if (frame.retry) retryMs = frame.retry;
          if (frame.id) lastEventId = frame.id;
          if (!frame.data) return; // keep-alive comment or empty frame
          try {
            const e = JSON.parse(frame.data) as InlookEvent;
            if (e.seq <= lastSeq) return; // already seen (replay overlap)
            lastSeq = e.seq;
            if (KNOWN.has(e.type)) onEvent(e);
            else console.warn("[sse] unknown event type", e.type);
          } catch (err) {
            console.warn("[sse] bad frame", err);
          }
        });
      } catch (err) {
        if (stopped) break;
        console.warn("[sse]", (err as Error).message);
      }
      onStatus("closed");
      if (!stopped) await new Promise((r) => setTimeout(r, retryMs));
      retryMs = Math.min(retryMs * 2, 15000);
    }
  };
  void connect();

  return () => { stopped = true; controller?.abort(); };
}

interface Frame { id?: string; event?: string; data?: string; retry?: number }

async function readFrames(body: ReadableStream<Uint8Array>, onFrame: (f: Frame) => void) {
  const decoder = new TextDecoder();
  let buf = "";
  let frame: Frame = {};
  let data: string[] = [];
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + (buf.startsWith("\r\n", nl) ? 2 : 1));
      if (line === "") {
        if (data.length) frame.data = data.join("\n");
        onFrame(frame);
        frame = {}; data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
      else if (field === "id") frame.id = value;
      else if (field === "event") frame.event = value;
      else if (field === "retry" && /^\d+$/.test(value)) frame.retry = Number(value);
    }
  }
}
