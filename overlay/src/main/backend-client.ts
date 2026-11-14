// Typed HTTP client for the backend contract (shared/CONTRACT.md).
import { config } from "./config";
import type { AcceptedResponse, AudioChunk, CheckRequest, ReviewDecision, ReviewResponse } from "../shared/contract";

export class BackendError extends Error {
  constructor(readonly status: number, readonly body: string, path: string) {
    super(`backend ${path} → ${status}: ${body.slice(0, 200)}`);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(config.backendUrl + path, init);
  const text = await res.text();
  if (!res.ok) throw new BackendError(res.status, text, path);
  return (text ? JSON.parse(text) : {}) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const backend = {
  /** POST /audio: one ~10 s Opus chunk. Results arrive over SSE. */
  postAudio(chunk: AudioChunk): Promise<AcceptedResponse> {
    const form = new FormData();
    form.append("chunk", new Blob([chunk.data], { type: chunk.mime }), `chunk-${chunk.seqNo}.webm`);
    form.append("startedAt", chunk.startedAt);
    form.append("seqNo", String(chunk.seqNo));
    return request("/audio", { method: "POST", body: form });
  },

  /** POST /check: selection text, a single claim, or a screenshot. */
  postCheck(body: CheckRequest): Promise<AcceptedResponse> {
    return request("/check", json(body));
  },

  /** POST /reviews/:id: accept or reject a pending change. */
  postReview(id: string, decision: ReviewDecision): Promise<ReviewResponse> {
    return request(`/reviews/${encodeURIComponent(id)}`, json({ decision }));
  },
};
