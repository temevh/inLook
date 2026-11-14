// The reducer: how one stream event changes the records. Pure apart from mutating `r`,
// so the store, demo mode and the tests all share it.
import type { InlookEvent, Records } from "../types";

export function applyEvent(r: Records, e: InlookEvent): void {
  switch (e.type) {
    case "claim.verdict": {
      const f = r.facts[e.payload.factId];
      // Low tier updates itself (a fact.updated follows); medium and high wait for a review.
      if (f && e.payload.verdict === "outdated" && e.payload.card.criticality !== "low") f.status = "pending_review";
      break;
    }
    case "fact.updated": {
      const f = r.facts[e.payload.factId];
      if (!f) break;
      const v = e.payload.version;
      if (!f.versions.some((x) => x.at === v.at && x.value === v.value)) f.versions.push(v);
      f.value = v.value;
      f.status = "current";
      break;
    }
    case "review.created": {
      const p = e.payload;
      r.reviews[p.reviewId] ??= {
        id: p.reviewId, factId: p.factId, oldValue: p.oldValue, newValue: p.newValue, evidence: p.evidence,
        tier: p.tier, reviewers: p.reviewers.map((x) => x.id), status: "pending", createdAt: e.at,
      };
      for (const x of p.reviewers) r.people[x.id] ??= { ...x, reportsTo: null };
      break;
    }
    case "review.closed": {
      const rev = r.reviews[e.payload.reviewId];
      if (rev) { rev.status = e.payload.status; rev.closedAt = e.at; }
      const f = r.facts[e.payload.factId];
      if (f && e.payload.status === "rejected") f.status = "current";
      break;
    }
    case "strategy.flagged": {
      const s = r.strategies[e.payload.strategyId];
      if (s) s.status = "flagged";
      break;
    }
    case "strategy.healthy": {
      const s = r.strategies[e.payload.strategyId];
      if (s) s.status = "healthy";
      break;
    }
    case "message.created": {
      const p = e.payload;
      r.messages[p.messageId] ??= { id: p.messageId, to: p.to.map((x) => x.id), strategyId: p.strategyId, factId: p.factId, text: p.text, at: e.at };
      break;
    }
    default:
      // transcript.line, claim.spotted, claim.unverified: shown from the event log, no record changes.
      break;
  }
}

export type ClaimState = "checking" | "current" | "outdated" | "unverifiable" | "unverified";

export interface Claim {
  id: string;
  seq: number;
  text: string;
  source: string;
  state: ClaimState;
  factId?: string;
  oldValue?: string;
  newValue?: string | null;
  tier?: string;
  /**
   * The claim's numbers differ from what company memory held when it was checked: the speaker misstated
   * the fact, whatever its source says. Worked out here from the text, so it needs no backend field.
   */
  misstated?: boolean;
  /** Who said it, when the claim came from a transcript line. */
  speaker?: string;
  at: string;
}

/** Numbers in a text, "100,000" read as 100000 and "5.50" as 5.5. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,(?=\d{3}\b)/g, ""))).filter((n) => !Number.isNaN(n));
}

/** True when the claim names a number that the stored value does not contain. */
export function misstates(claim: string, stored: string): boolean {
  const said = numbersIn(claim);
  if (!said.length) return false;
  const known = numbersIn(stored);
  return said.some((n) => !known.includes(n));
}

/** Claims are not stored anywhere: they are folded from the event log (oldest first). */
export function claimsFrom(log: InlookEvent[]): Claim[] {
  const byId = new Map<string, Claim>();
  const speakers = new Map<string, string>();
  for (const e of log) {
    if (e.type === "transcript.line") {
      speakers.set(e.payload.lineId, e.payload.speaker);
    } else if (e.type === "claim.spotted") {
      const speaker = e.payload.lineId ? speakers.get(e.payload.lineId) : undefined;
      byId.set(e.payload.claimId, { id: e.payload.claimId, seq: e.seq, text: e.payload.text, source: e.payload.source, state: "checking", speaker, at: e.at });
    } else if (e.type === "claim.verdict") {
      const c = byId.get(e.payload.claimId);
      if (c) Object.assign(c, {
        state: e.payload.verdict, factId: e.payload.factId, oldValue: e.payload.oldValue, newValue: e.payload.newValue,
        tier: e.payload.card.criticality, misstated: misstates(c.text, e.payload.oldValue),
      });
    } else if (e.type === "claim.unverified") {
      const c = byId.get(e.payload.claimId);
      if (c) c.state = "unverified";
    }
  }
  return [...byId.values()].sort((a, b) => b.seq - a.seq);
}
