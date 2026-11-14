// Reads go to the Prisma data API (/api, port 3001); actions go to the FastAPI backend (port 8000).
// Both are reached through the Vite dev proxy, see vite.config.ts.
import type { Fact, InlookEvent, Message, Review, Snapshot, Strategy } from "../types";
import type { Person } from "../types";
import { withHierarchy } from "../mock/org";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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

const post = <T>(url: string, body: unknown) =>
  json<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const decideReview = (id: string, decision: "accept" | "reject") =>
  post<{ id: string; status: string }>(`/reviews/${encodeURIComponent(id)}`, { decision });

export const recheckFact = (factId: string) => post<{ accepted: boolean; facts: number }>("/recheck", { factId });

export const checkClaim = (text: string) => post<{ accepted: boolean }>("/check", { kind: "text", text, source: "claim" });

/** Only when the backend runs with INLOOK_DEV=1. Used by "Play meeting" in live mode. */
export const devEvent = (type: string, payload: unknown) => post("/dev/events", { type, payload });
