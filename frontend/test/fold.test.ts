import { describe, expect, it } from "vitest";
import { decide, matchFact, routeClaim, type Step } from "../src/data/demo";
import { applyEvent, claimsFrom, misstates, numbersIn } from "../src/lib/fold";
import { buildInbox } from "../src/lib/inbox";
import { scoped, scopeOf } from "../src/lib/scope";
import { MEETING } from "../src/mock/script";
import { demoSnapshot } from "../src/mock/seed";
import type { InlookEvent, Records } from "../src/types";

/** The demo snapshot (history already folded in), then the whole meeting, folded synchronously. */
function replay(withMeeting = true): { r: Records; log: InlookEvent[] } {
  const { events, ...r } = demoSnapshot();
  const log = [...events].reverse();
  const fold = (steps: Step[]) => steps.forEach((s) => {
    const e = { seq: log.length + 1, type: s.type, payload: s.payload, at: `2026-11-14T10:${String(log.length % 60).padStart(2, "0")}:00Z` } as InlookEvent;
    applyEvent(r, e);
    log.push(e);
  });
  if (withMeeting) {
    MEETING.forEach((m, i) => {
      fold([{ delayMs: 0, type: "transcript.line", payload: { lineId: `line-${i + 1}`, speaker: m.speaker, text: m.line } }]);
      if (m.claim) fold(routeClaim(r, { ...m.claim, source: m.claim.source ?? "audio", lineId: `line-${i + 1}` }, "2026-11-14T10:00:00Z"));
    });
  }
  return { r, log };
}
const pendingFor = (r: Records, factId: string) => Object.values(r.reviews).filter((x) => x.factId === factId && x.status === "pending");

describe("demo history", () => {
  const { r, log } = replay(false);

  it("is a consistent event log, oldest first after reversing", () => {
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
    expect(log.every((e, i) => i === 0 || e.at > log[i - 1].at)).toBe(true);
  });

  it("has a rejected review and an open one", () => {
    expect(Object.values(r.reviews).map((x) => [x.factId, x.status, x.closedBy ?? null])).toEqual([
      ["f-refund-window", "rejected", "p-sam"], ["f-ticket-volume", "pending", null],
    ]);
    expect(r.facts["f-refund-window"]).toMatchObject({ value: "30 days", status: "current" });
    // Stated as low, but two strategies rely on it: treated as medium, so Sam (who stated it) reviews it.
    expect(pendingFor(r, "f-ticket-volume")[0]).toMatchObject({ tier: "medium", reviewers: ["p-sam"] });
    expect(Object.values(r.strategies).every((s) => s.status === "healthy")).toBe(true);
  });
});

describe("the meeting", () => {
  it("routes each tier", () => {
    const { r, log } = replay();
    // High, two strategies: both owners decide, both strategies are flagged.
    expect(pendingFor(r, "f-compx-price")[0].reviewers).toEqual(["p-ada", "p-casey"]);
    // High, one strategy: its owner decides, not Ada who stated it.
    expect(pendingFor(r, "f-eur-usd")[0].reviewers).toEqual(["p-casey"]);
    // Medium: whoever stated it, no flag.
    expect(pendingFor(r, "f-refund-window")[0].reviewers).toEqual(["p-sam"]);
    // Low and unused: automatic.
    expect(r.facts["f-wifi-name"].value).toBe("MockNet-5G");
    // Already in review: not asked twice.
    expect(pendingFor(r, "f-ticket-volume")).toHaveLength(1);
    expect(Object.values(r.strategies).filter((s) => s.status === "flagged").map((s) => s.id).sort()).toEqual(["s-budget", "s-pricing"]);
    // The budget is flagged once, but Casey hears about both changes.
    expect(log.filter((e) => e.type === "strategy.flagged" && e.payload.strategyId === "s-budget")).toHaveLength(1);
    expect(Object.values(r.messages).filter((m) => m.strategyId === "s-budget")).toHaveLength(2);
  });

  it("produces the claim states, with speakers", () => {
    const { log } = replay();
    const meeting = claimsFrom(log).filter((c) => c.speaker).reverse();
    expect(meeting.map((c) => c.state)).toEqual(["outdated", "outdated", "outdated", "outdated", "outdated", "unverified", "current"]);
    expect(meeting[0].speaker).toBe("Sam Sample");
    // Ada said 1.10 while memory holds 1.08 (and the source says 1.16).
    expect(meeting.filter((c) => c.misstated).map((c) => c.factId)).toEqual(["f-eur-usd"]);
  });

  it("heals a strategy only when none of its facts is in review", () => {
    const { r } = replay();
    const fold = (steps: Step[]) => steps.forEach((s, i) => applyEvent(r, { seq: 900 + i, type: s.type, payload: s.payload, at: "x" } as InlookEvent));
    fold(decide(r, pendingFor(r, "f-compx-price")[0], "accept", "x", "p-casey"));
    expect(r.facts["f-compx-price"].value).toBe("$10 per seat per month");
    expect(r.facts["f-compx-price"].versions.at(-1)?.by).toBe("p-casey");
    expect(r.strategies["s-pricing"].status).toBe("healthy");
    expect(r.strategies["s-budget"].status).toBe("flagged"); // the exchange rate is still in review
    fold(decide(r, pendingFor(r, "f-eur-usd")[0], "accept", "x", "p-casey"));
    expect(r.strategies["s-budget"].status).toBe("flagged"); // ticket volume (medium) still in review
  });

  it("matches typed claims by keyword", () => {
    const { r } = replay(false);
    expect(matchFact("Is it still 1.08 dollars per euro?", r)).toBe("f-eur-usd");
    expect(matchFact("We sell ice cream", r)).toBeNull();
  });
});

describe("hierarchy scope", () => {
  const { r } = replay();
  const view = (id: string) => scoped(id, r);

  it("gives the CEO everything", () => {
    expect(scopeOf("p-casey", r.people).size).toBe(5);
    expect(view("p-casey").facts.size).toBe(5);
    expect(view("p-casey").strategies).toHaveLength(3);
  });

  it("gives the COO her subtree", () => {
    const v = view("p-noor");
    expect([...v.team].sort()).toEqual(["p-mira", "p-noor", "p-sam"]);
    expect(v.strategies.map((s) => s.id)).toEqual(["s-support"]);
    expect([...v.facts].sort()).toEqual(["f-compx-price", "f-refund-window", "f-ticket-volume", "f-wifi-name"]);
  });

  it("follows strategies across teams and limits individuals", () => {
    expect([...view("p-ada").facts].sort()).toEqual(["f-compx-price", "f-eur-usd"]);
    expect([...view("p-mira").facts]).toEqual(["f-wifi-name"]);
    expect(view("p-mira").strategies).toHaveLength(0);
  });
});

describe("misstated numbers", () => {
  it("reads numbers the way people write them", () => {
    expect(numbersIn("$100,000 in sales, 5.50 per click, 24%")).toEqual([100000, 5.5, 24]);
  });
  it("flags a claim whose number company memory does not hold", () => {
    expect(misstates("We plan with 1 EUR = 1.10 USD", "1 EUR = 1.08 USD")).toBe(true);
    expect(misstates("Notion Plus costs $8 per seat per month", "$8 per seat per month")).toBe(false);
    expect(misstates("The office wifi is called MockNet", "MockNet")).toBe(false);
  });
});

describe("notification inbox", () => {
  const { r, log } = replay();
  const inbox = (id: string) => buildInbox(id, scoped(id, r), r, log);

  it("asks reviewers to decide, with a link to the review", () => {
    const d = inbox("p-casey").filter((i) => i.kind === "Needs your decision");
    expect(d).toHaveLength(2);
    expect(d.every((i) => i.actions[0].to.startsWith("/#review-"))).toBe(true);
  });

  it("links messages to the strategy and offers the decision when it is yours", () => {
    const m = inbox("p-ada").find((i) => i.kind === "Message")!;
    expect(m.actions.map((a) => a.label)).toEqual(["Decide now", "Open Mock Pricing Plan", "Open fact"]);
  });

  it("tells others who decided, but not the person who did", () => {
    const kinds = (id: string) => inbox(id).map((i) => `${i.kind}: ${i.text.slice(0, 20)}`);
    expect(kinds("p-noor")).toContain("Kept old value: Sam Sample kept 30 d");
    expect(kinds("p-sam").some((k) => k.startsWith("Kept old value"))).toBe(false);
    expect(inbox("p-mira").map((i) => i.kind)).toEqual(["Updated"]);
  });
});
