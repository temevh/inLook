// HUD card policy without DOM: which card to evict when space runs out, and which card a fact event reuses.

/** Importance of a card; lower goes first. `null` = never evicted (pending review). */
export type Rank = number | null;

export interface CardInfo { tier?: string; kind: "claim" | "review" | "strategy" | "message" | "other"; resolved?: boolean; unverified?: boolean }

export function rankOf(c: CardInfo): Rank {
  if (c.kind === "review" && !c.resolved) return null; // waits for a decision
  if (c.kind === "strategy" || c.kind === "message") return 4; // flagged strategies and messages stay until resolved
  if (c.unverified || c.tier === undefined || c.tier === "low") return 1;
  return c.tier === "medium" ? 2 : 3;
}

/** Index of the card to drop, or -1. `ranks` is in stack order (0 = newest, which is never dropped).
 *  Lowest rank first, the oldest (highest index) among equals. */
export function evictionTarget(ranks: Rank[]): number {
  let best = -1;
  for (let i = ranks.length - 1; i >= 1; i--) {
    const r = ranks[i];
    if (r == null) continue;
    if (best < 0 || r < (ranks[best] as number)) best = i;
  }
  return best;
}

/** A fact's verdict card is reused by the fact.updated / review.created that follows it, so one fact shows one headline. */
export class FactCards {
  private byFact = new Map<string, string>();
  constructor(private max = 100) {}
  /** Remember the card key that shows this fact's verdict. */
  verdict(factId: string, key: string) {
    this.byFact.delete(factId);
    this.byFact.set(factId, key);
    if (this.byFact.size > this.max) this.byFact.delete(this.byFact.keys().next().value!);
  }
  /** Key to render a fact event on: the verdict card if `usable(key)`, else `own`. */
  keyFor(factId: string, own: string, usable: (key: string) => boolean) {
    const k = this.byFact.get(factId);
    return k !== undefined && usable(k) ? k : own;
  }
}

/** "Label: old → new" (the card text the backend writes for a change) → its parts, or null for any other text.
 *  Splits at the last " → " and the last ": " before it, so a label or value with a colon still works. */
export function splitChange(text: string): { label: string; old: string; new: string } | null {
  const arrow = text.lastIndexOf(" → ");
  const colon = arrow < 0 ? -1 : text.lastIndexOf(": ", arrow);
  if (colon < 0) return null;
  const parts = { label: text.slice(0, colon), old: text.slice(colon + 2, arrow), new: text.slice(arrow + 3) };
  return parts.label && parts.old && parts.new ? parts : null;
}
