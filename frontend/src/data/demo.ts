// Demo mode: a stand-in for the backend that runs in the browser, so the dashboard can be shown
// without MongoDB, Gemini or Context.dev. It routes claims the way the backend does
// (low: update itself, medium: review by whoever stated the fact, high: review by the owners of every
// strategy relying on it, plus a flag and a message per strategy) and produces the same contract events.
// What each fact's source "says today" comes from src/mock/demo-data.json.
import data from "../mock/demo-data.json";
import { effectiveTier } from "../lib/scope";
import type { InlookEvent, Records, Review } from "../types";

export type Source = "audio" | "selection" | "screenshot" | "page";
export type Emit = <T extends InlookEvent["type"]>(type: T, payload: Extract<InlookEvent, { type: T }>["payload"]) => void;

/** One event to send, after waiting delayMs. Steps are computed up front, then played or folded. */
export interface Step { delayMs: number; type: InlookEvent["type"]; payload: InlookEvent["payload"] }

export interface DemoClaim { text: string; source: Source; factId?: string | null; lineId?: string }

interface LiveValue { value: string; evidence: string }
const LIVE: Record<string, LiveValue | null> = Object.fromEntries(data.facts.map((f) => [f.id, f.live]));
const KEYWORDS: [string, string[]][] = data.facts.map((f) => [f.id, f.keywords]);

let n = 0;
const nextId = (prefix: string) => `${prefix}-${++n}`;
/** Restarts the id counter, so a fresh demo produces the same ids. */
export function resetIds(): void { n = 0; }

/** The fact a free-text claim is about, by keyword. The backend uses Gemini for this. */
export function matchFact(text: string, r: Records): string | null {
  const t = text.toLowerCase();
  for (const [id, words] of KEYWORDS) if (r.facts[id] && words.some((w) => t.includes(w))) return id;
  return null;
}

const step = <T extends InlookEvent["type"]>(delayMs: number, type: T, payload: Extract<InlookEvent, { type: T }>["payload"]): Step =>
  ({ delayMs, type, payload });

/** Everything the backend would emit for one claim, given the records as they are now. */
export function routeClaim(r: Records, c: DemoClaim, when: string): Step[] {
  const claimId = nextId("demo-claim");
  const steps: Step[] = [step(0, "claim.spotted", { claimId, text: c.text, source: c.source, lineId: c.lineId ?? null })];
  const fact = c.factId ? r.facts[c.factId] : undefined;
  if (!fact) {
    steps.push(step(1200, "claim.unverified", { claimId, reason: "no_match" }));
    return steps;
  }
  const live = LIVE[fact.id];
  // A low-tier fact that a strategy relies on is treated as medium (the backend's "dependency floor").
  const tier = effectiveTier(fact.id, fact.tier, r.strategies);
  const line = (v: string) => `${fact.label}: ${v}`;
  if (!live) {
    steps.push(step(1600, "claim.verdict", {
      claimId, factId: fact.id, verdict: "unverifiable", oldValue: fact.value, newValue: null,
      evidence: "No public source states this value, so only the person who stated it can confirm it.",
      sourceUrl: fact.sourceUrl, card: { title: "Needs review", criticality: tier, fact: line(fact.value) },
    }));
    return steps;
  }
  if (live.value === fact.value) {
    steps.push(step(1600, "claim.verdict", {
      claimId, factId: fact.id, verdict: "current", oldValue: fact.value, newValue: null, evidence: live.evidence,
      sourceUrl: fact.sourceUrl, card: { title: "Fact updated", criticality: tier, fact: `${line(fact.value)} (still current)` },
    }));
    return steps;
  }
  const change = `${fact.label}: ${fact.value} → ${live.value}`;
  steps.push(step(1600, "claim.verdict", {
    claimId, factId: fact.id, verdict: "outdated", oldValue: fact.value, newValue: live.value, evidence: live.evidence,
    sourceUrl: fact.sourceUrl, card: { title: "Fact outdated", criticality: tier, fact: change },
  }));
  // A review is already open for this fact: the verdict is enough, nobody is asked twice.
  if (Object.values(r.reviews).some((x) => x.factId === fact.id && x.status === "pending")) return steps;

  if (tier === "low") {
    steps.push(step(600, "fact.updated", {
      factId: fact.id, version: { value: live.value, source: fact.sourceUrl ?? "", at: when, by: "inlook" },
      card: { title: "Fact updated", criticality: "low", fact: change },
    }));
    return steps;
  }

  const relying = Object.values(r.strategies).filter((s) => s.factIds.includes(fact.id));
  // Medium, or high with no strategy relying on it: whoever stated it. High: every owner of a relying strategy.
  const ids = tier === "high" && relying.length ? [...new Set(relying.flatMap((s) => s.owners))].sort() : [fact.statedBy];
  const person = (id: string) => { const p = r.people[id]; return { id, name: p?.name ?? id, role: p?.role ?? "" }; };
  steps.push(step(600, "review.created", {
    reviewId: nextId(`r-${fact.id.slice(2)}`), factId: fact.id, oldValue: fact.value, newValue: live.value, evidence: live.evidence,
    tier, reviewers: ids.map(person), card: { title: "Needs review", criticality: tier, fact: change },
  }));
  if (tier === "high") {
    for (const s of relying) {
      // A strategy that is already flagged is not flagged again, but its owners still hear about the new change.
      if (s.status !== "flagged") steps.push(step(400, "strategy.flagged", { strategyId: s.id, name: s.name, factId: fact.id }));
      steps.push(step(300, "message.created", {
        messageId: nextId("m"), to: s.owners.map(person), strategyId: s.id, factId: fact.id,
        text: `${fact.label} changed: ${fact.value} → ${live.value}. ${s.name} relies on the old value and needs a look.`,
      }));
    }
  }
  return steps;
}

/** A reviewer's decision, and the strategies it heals. */
export function decide(r: Records, review: Review, decision: "accept" | "reject", when: string): Step[] {
  const fact = r.facts[review.factId];
  const steps: Step[] = [step(0, "review.closed", { reviewId: review.id, factId: review.factId, status: decision === "accept" ? "accepted" : "rejected" })];
  if (decision === "accept" && fact) {
    steps.push(step(200, "fact.updated", {
      factId: fact.id,
      version: { value: review.newValue, source: fact.sourceUrl ?? "", at: when, by: "reviewer" },
      card: { title: "Fact updated", criticality: review.tier, fact: `${fact.label}: ${review.oldValue} → ${review.newValue}` },
    }));
  }
  const stillPending = (sid: string) =>
    Object.values(r.reviews).some((x) => x.id !== review.id && x.status === "pending" && r.strategies[sid].factIds.includes(x.factId));
  for (const s of Object.values(r.strategies)) {
    if (s.status === "flagged" && s.factIds.includes(review.factId) && !stillPending(s.id)) steps.push(step(200, "strategy.healthy", { strategyId: s.id, name: s.name }));
  }
  return steps;
}
