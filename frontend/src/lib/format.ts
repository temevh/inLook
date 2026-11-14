import type { InlookEvent, Records } from "../types";

export const SOURCE_LABEL: Record<string, string> = {
  audio: "meeting audio", selection: "selected text", screenshot: "screenshot", page: "source page re-check",
};

/** Time of day for today's events; date and time for older ones (the demo history goes back weeks). */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function domain(url: string | null | undefined): string {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function personName(id: string, r: Records): string {
  if (id === "inlook") return "inLook (automatic)";
  if (id === "reviewer") return "a reviewer";
  return r.people[id]?.name ?? id;
}

/** One line per event for the Activity log. */
export function summarize(e: InlookEvent, r: Records): string {
  const fact = (id: string) => r.facts[id]?.label ?? id;
  switch (e.type) {
    case "transcript.line": return `${e.payload.speaker}: ${e.payload.text}`;
    case "claim.spotted": return `“${e.payload.text}” · ${SOURCE_LABEL[e.payload.source] ?? e.payload.source}`;
    case "claim.unverified": return e.payload.reason === "no_match" ? "No matching fact" : "Could not verify";
    case "claim.verdict": return `${e.payload.verdict} · ${e.payload.card.fact}`;
    case "fact.updated": return e.payload.card.fact;
    case "review.created": return `${fact(e.payload.factId)} · ${e.payload.tier} · reviewer ${e.payload.reviewers.map((p) => p.name).join(", ")}`;
    case "review.closed": return `${fact(e.payload.factId)} · ${e.payload.status}`;
    case "strategy.flagged": return `${e.payload.name} · relies on ${fact(e.payload.factId)}`;
    case "strategy.healthy": return e.payload.name;
    case "message.created": return `To ${e.payload.to.map((p) => p.name).join(", ")} · ${e.payload.text}`;
  }
}

/** Which records an event is about, for filtering the log to a viewer's scope. */
export function eventFact(e: InlookEvent, r: Records, claimFacts: Map<string, string>): string | undefined {
  const p = e.payload as unknown as Record<string, unknown>;
  if (typeof p.factId === "string") return p.factId;
  if (typeof p.claimId === "string") return claimFacts.get(p.claimId);
  if (typeof p.reviewId === "string") return r.reviews[p.reviewId]?.factId;
  if (typeof p.strategyId === "string") return r.strategies[p.strategyId]?.factIds[0];
  return undefined;
}
