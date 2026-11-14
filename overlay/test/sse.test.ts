// subscribe() against a local SSE server. Runs the compiled dist/main code (see `pretest`),
// because validate.ts reads dist/schemas relative to its own location.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const at = "2026-01-01T00:00:00.000Z";
const line = (seq: number, text = `t${seq}`) => ({
  seq, type: "transcript.line", at, payload: { lineId: `l${seq}`, speaker: "A", text },
});
const frame = (e: { seq: number; type: string }, id: number = e.seq) =>
  `id: ${id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

let server: Server;
const requests: IncomingMessage[] = [];
const conns: ServerResponse[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    conns.push(res);
    if (requests.length === 1) {
      const bad = { ...line(3), payload: { lineId: "l3" } }; // missing speaker/text
      res.write("retry: 50\n\n");
      res.write(frame(line(1)) + frame(line(2)) + frame(line(2)) + frame(bad) + frame(line(4)));
      setTimeout(() => res.end(), 100); // server drops the connection
    } else {
      res.write(frame(line(5)));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.INLOOK_BACKEND_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  conns.forEach((c) => c.destroy());
  server.close();
});

describe("subscribe", () => {
  it("delivers in order, dedups seq, drops invalid, reconnects with Last-Event-ID", async () => {
    const { subscribe } = await import("../dist/main/sse.js");
    const seqs: number[] = [];
    const stop = subscribe({
      onEvent: (e: { seq: number }) => seqs.push(e.seq),
      onStatus: () => {},
    });
    try {
      await expect.poll(() => seqs.length, { timeout: 3000 }).toBe(4);
      expect(seqs).toEqual([1, 2, 4, 5]); // dup 2 once, invalid 3 dropped, 5 after reconnect
      expect(requests).toHaveLength(2);
      expect(requests[0]!.headers["last-event-id"]).toBeUndefined();
      expect(requests[1]!.headers["last-event-id"]).toBe("4");
    } finally {
      stop();
    }
  });
});
