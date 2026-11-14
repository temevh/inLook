// Typed HTTP client for the backend contract (shared/CONTRACT.md).
import { config } from "./config";
import { OFFLINE_MESSAGE, httpErrorMessage } from "./errors";
import type { AcceptedResponse, CheckRequest, ReviewRequest, ReviewResponse } from "../shared/contract.gen";

/** `message` is the short text shown to the user. Status 0 means the backend was unreachable. */
export class BackendError extends Error {
  constructor(readonly status: number, readonly body: string, readonly path: string) {
    super(status === 0 ? OFFLINE_MESSAGE : httpErrorMessage(status));
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response, text: string;
  try {
    res = await fetch(config.backendUrl + path, init);
    text = await res.text();
  } catch (err) {
    console.warn(`[inlook] backend ${path} unreachable: ${(err as Error).message}`);
    throw new BackendError(0, String(err), path);
  }
  if (!res.ok) {
    console.warn(`[inlook] backend ${path} → ${res.status}: ${text.slice(0, 200)}`);
    throw new BackendError(res.status, text, path);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const backend = {
  /** POST /check: selection text, a single claim, or a screenshot. */
  postCheck(body: CheckRequest): Promise<AcceptedResponse> {
    return request("/check", json(body));
  },

  /** POST /reviews/:id: accept or reject a pending change. */
  postReview(id: string, decision: ReviewRequest["decision"]): Promise<ReviewResponse> {
    return request(`/reviews/${encodeURIComponent(id)}`, json({ decision }));
  },
};
