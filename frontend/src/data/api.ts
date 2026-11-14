// Reads go to the Prisma data API (/api, port 3001); actions go to the FastAPI backend (port 8000).
// Both are reached through the Vite dev proxy, see vite.config.ts.
// Demo mode can point everything at the mock backend instead (server/mock-backend.ts, under /mock).
import type { Fact, InlookEvent, Message, Review, Snapshot, Strategy } from "../types";
import type { Person } from "../types";
import { withHierarchy } from "../mock/org";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** "" for the real services, "/mock" for the mock backend. */
let base = "";
/** Sent as x-inlook-user to the mock backend, so its log shows who acted. The real backend has no login yet. */
let user: string | null = null;
export function useBackend(prefix: "" | "/mock", as: string | null = null) { base = prefix; user = as; }
export function actAs(id: string | null) { user = id; }
export const streamUrl = () => `${base}/stream`;

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (base && user && !headers.has("x-inlook-user")) headers.set("x-inlook-user", user);
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try { const body = await res.json(); detail = body.detail ?? body.error ?? detail; } catch { /* not JSON */ }
    throw new HttpError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((x) => [x.id, x]));

export async function loadSnapshot(): Promise<Snapshot> {
  const [people, facts, strategies, reviews, messages, events] = await Promise.all([
    json<Omit<Person, "reportsTo">[]>("/api/people"),
    json<Fact[]>("/api/facts"),
    json<Strategy[]>("/api/strategies"),
    json<Review[]>("/api/reviews"),
    json<Message[]>("/api/messages"),
    json<InlookEvent[]>("/api/events"),
  ]);
  return { people: withHierarchy(people), facts: byId(facts), strategies: byId(strategies), reviews: byId(reviews), messages: byId(messages), events };
}

const post = <T>(url: string, body: unknown, as?: string) =>
  json<T>(url, { method: "POST", headers: { "content-type": "application/json", ...(base && as ? { "x-inlook-user": as } : {}) }, body: JSON.stringify(body) });

export const decideReview = (id: string, decision: "accept" | "reject", as?: string) =>
  post<{ id: string; status: string }>(`/reviews/${encodeURIComponent(id)}`, { decision }, as);

export const recheckFact = (factId: string) => post<{ accepted: boolean; facts: number }>("/recheck", { factId });

export const checkClaim = (text: string) => post<{ accepted: boolean }>("/check", { kind: "text", text, source: "claim" });

/** Only when the backend runs with INLOOK_DEV=1. Used by "Play meeting" in live mode. */
export const devEvent = (type: string, payload: unknown) => post("/dev/events", { type, payload });

/** Mock backend only: is it running? Answers within a second either way. */
export async function mockAlive(): Promise<boolean> {
  try {
    const res = await fetch("/mock/health", { signal: AbortSignal.timeout(1000) });
    return res.ok && (await res.json()).mock === true;
  } catch { return false; }
}

/** Mock backend only: reseed it, like `python -m app.seed` on the real one. */
export const resetMock = () => post<{ ok: boolean; bootId: string }>("/dev/reset", {});
