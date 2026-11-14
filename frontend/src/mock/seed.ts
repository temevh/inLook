// MOCK DATA for demo mode, from demo-data.json. The records start as the JSON describes them, then
// the JSON's history runs through the same demo engine the buttons use, so past reviews, messages,
// flags and updates are ordinary events in the log and the records agree with them.
import data from "./demo-data.json";
import { decide, resetIds, routeClaim, type Source, type Step } from "../data/demo";
import { applyEvent } from "../lib/fold";
import type { Fact, InlookEvent, Records, Snapshot, Strategy } from "../types";
import { withHierarchy } from "./org";

interface HistoryItem {
  at: string;
  claim?: { factId: string; text: string; source: Source };
  decide?: { factId: string; decision: "accept" | "reject"; by: string };
}

export function demoSnapshot(): Snapshot {
  resetIds();
  const copy = JSON.parse(JSON.stringify(data)) as typeof data;
  const r: Records = {
    people: withHierarchy(copy.people),
    facts: Object.fromEntries(copy.facts.map(({ keywords: _k, live: _l, since, ...f }) => [f.id, {
      ...f, status: "current", versions: [{ value: f.value, source: f.sourceUrl ?? "", at: since, by: f.statedBy }],
    } as Fact])),
    strategies: Object.fromEntries(copy.strategies.map((s) => [s.id, { ...s, status: "healthy" } as Strategy])),
    reviews: {},
    messages: {},
  };

  const events: InlookEvent[] = [];
  const play = (steps: Step[], at: string) => {
    let t = Date.parse(at);
    for (const s of steps) {
      t += Math.max(s.delayMs, 1000);
      const e = { seq: events.length + 1, type: s.type, payload: s.payload, at: new Date(t).toISOString() } as InlookEvent;
      applyEvent(r, e);
      events.push(e);
    }
  };
  for (const h of copy.history as HistoryItem[]) {
    if (h.claim) play(routeClaim(r, h.claim, h.at), h.at);
    if (h.decide) {
      const review = Object.values(r.reviews).find((x) => x.factId === h.decide!.factId && x.status === "pending");
      if (review) {
        review.closedBy = h.decide.by;
        play(decide(r, review, h.decide.decision, h.at, h.decide.by), h.at);
      }
    }
  }
  return { ...r, events: events.reverse() };
}
