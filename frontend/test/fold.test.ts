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

  it("covers accepted, rejected, automatic and open changes", () => {
    expect(r.facts["f-slack-price"].value).toBe("$8.75 per user per month");
    expect(r.facts["f-slack-price"].versions).toHaveLength(2);
    expect(r.facts["f-office-hours"].versions.at(-1)?.by).toBe("inlook");
    expect(r.facts["f-api-rate-limit"].versions.at(-1)?.by).toBe("inlook");
    expect(r.facts["f-discount-cap"]).toMatchObject({ value: "20%", status: "current" });
    expect(Object.values(r.reviews).map((x) => [x.factId, x.status])).toEqual([
      ["f-competitor-launch", "accepted"], ["f-slack-price", "accepted"], ["f-discount-cap", "rejected"], ["f-cloud-cost", "accepted"],
      ["f-hubspot-price", "pending"], ["f-salary-band", "pending"], ["f-competitor-y-seats", "pending"], ["f-ticket-volume", "pending"],
    ]);
    // High tier with two relying strategies: all four owners were asked, both strategies healed on accept.
    expect(Object.values(r.reviews)[0].reviewers).toEqual(["p-ada", "p-omar", "p-pia", "p-viktor"]);
    expect(pendingFor(r, "f-competitor-y-seats")[0].reviewers).toEqual(["p-raj", "p-tess"]);
    expect(Object.values(r.strategies).filter((s) => s.status === "flagged").map((s) => s.id)).toEqual(["s-sales-deck"]);
  });
});

describe("the meeting", () => {
  it("routes each tier", () => {
    const { r, log } = replay();
    // High: every owner of every relying strategy.
    expect(pendingFor(r, "f-compx-price")[0].reviewers).toEqual(["p-ada", "p-elin", "p-raj", "p-tess"]);
    expect(pendingFor(r, "f-eur-usd")[0].reviewers).toEqual(["p-ada", "p-elin", "p-omar", "p-raj"]);
    // High with no relying strategy: whoever stated it.
    expect(pendingFor(r, "f-office-lease")[0].reviewers).toEqual(["p-mira"]);
    // Medium: whoever stated it, no flag.
    expect(pendingFor(r, "f-refund-window")[0].reviewers).toEqual(["p-sam"]);
    expect(r.strategies["s-returns"].status).toBe("healthy");
    // Low, but a strategy relies on it: treated as medium.
    expect(pendingFor(r, "f-onboarding-days")[0]).toMatchObject({ tier: "medium", reviewers: ["p-hana"] });
    // Low and unused: automatic.
    expect(r.facts["f-wifi-name"].value).toBe("MockNet-5G");
    // Already in review: not asked twice.
    expect(pendingFor(r, "f-ticket-volume")).toHaveLength(1);
    expect(Object.values(r.strategies).filter((s) => s.status === "flagged").map((s) => s.id).sort()).toEqual(
      ["s-budget", "s-marketing-stack", "s-pricing", "s-sales-deck", "s-us-expansion"],
    );
    // An already flagged strategy is not flagged again, but its owners still get a message.
    const flags = log.filter((e) => e.type === "strategy.flagged" && e.payload.strategyId === "s-budget");
    const budgetMsgs = Object.values(r.messages).filter((m) => m.strategyId === "s-budget");
    expect(flags).toHaveLength(1);
    expect(budgetMsgs).toHaveLength(2);
  });

  it("produces every claim state, with speakers", () => {
    const { log } = replay();
    const meeting = claimsFrom(log).filter((c) => c.speaker).reverse();
    expect(meeting.map((c) => c.state)).toEqual([
      "outdated", "outdated", "current", "outdated", "outdated", "current", "current", "unverifiable", "unverified",
      "outdated", "outdated", "outdated", "current", "outdated", "current", "outdated", "current", "current",
    ]);
    expect(meeting[0].speaker).toBe("Sam Sample");
    // Only the API rate limit was misstated: memory says 120 (updated automatically), the speaker said 100.
    expect(meeting.filter((c) => c.misstated).map((c) => c.factId)).toEqual(["f-api-rate-limit"]);
  });

  it("heals a strategy only when none of its facts is in review", () => {
    const { r } = replay();
    const fold = (steps: Step[]) => steps.forEach((s, i) => applyEvent(r, { seq: 900 + i, type: s.type, payload: s.payload, at: "x" } as InlookEvent));
    fold(decide(r, pendingFor(r, "f-compx-price")[0], "accept", "x"));
    expect(r.facts["f-compx-price"].value).toBe("$10 per seat per month");
    expect(r.strategies["s-pricing"].status).toBe("flagged"); // the exchange rate is still in review
    fold(decide(r, pendingFor(r, "f-eur-usd")[0], "accept", "x"));
    expect(r.strategies["s-pricing"].status).toBe("healthy");
    expect(r.strategies["s-us-expansion"].status).toBe("healthy");
    expect(r.strategies["s-marketing-stack"].status).toBe("flagged"); // HubSpot price (medium) still in review
    expect(r.strategies["s-sales-deck"].status).toBe("flagged"); // MockDesk seats still in review
  });

  it("matches typed claims by keyword", () => {
    const { r } = replay(false);
    expect(matchFact("Is the VAT still 24%?", r)).toBe("f-eu-vat");
    expect(matchFact("We sell ice cream", r)).toBeNull();
  });
});

describe("hierarchy scope", () => {
  const { r } = replay();
  const view = (id: string) => scoped(id, r);

  it("gives the CEO everything", () => {
    expect(scopeOf("p-casey", r.people).size).toBe(17);
    expect(view("p-casey").facts.size).toBe(24);
    expect(view("p-casey").strategies).toHaveLength(12);
  });

  it("gives the COO her subtree", () => {
    const v = view("p-noor");
    expect([...v.team].sort()).toEqual(["p-hana", "p-ivy", "p-mira", "p-noor", "p-sam"]);
    expect(v.strategies.map((s) => s.id).sort()).toEqual(["s-hiring-plan", "s-returns", "s-support-staffing"]);
    expect(v.facts.size).toBe(11);
    expect(v.facts.has("f-compx-price")).toBe(true); // Sam stated it
    expect(v.facts.has("f-eu-vat")).toBe(false);
  });

  it("follows strategies across teams", () => {
    // Ada sees facts other teams stated because her strategies rely on them.
    expect([...view("p-ada").facts].sort()).toEqual(["f-competitor-launch", "f-compx-price", "f-eur-usd", "f-gdpr-fine-cap", "f-slack-price", "f-uptime-sla"]);
    expect([...view("p-mira").facts].sort()).toEqual(["f-office-hours", "f-office-lease", "f-parking", "f-wifi-name"]);
    expect(view("p-mira").strategies).toHaveLength(0);
    expect(view("p-jon").strategies.map((s) => s.id)).toEqual(["s-cloud-plan"]); // owned by his report
    expect(view("p-elin").strategies).toHaveLength(3);
  });
});

describe("misstated numbers", () => {
  it("reads numbers the way people write them", () => {
    expect(numbersIn("$100,000 in sales, 5.50 per click, 24%")).toEqual([100000, 5.5, 24]);
  });
  it("flags a claim whose number company memory does not hold", () => {
    expect(misstates("The API allows 100 requests per minute", "120 requests per minute")).toBe(true);
    expect(misstates("We plan with 1 EUR = 1.08 USD", "1 EUR = 1.08 USD")).toBe(false);
    expect(misstates("The office wifi is called MockNet", "MockNet")).toBe(false);
  });
});

describe("decisions by other people", () => {
  it("records who decided, in the review and the new version", () => {
    const { r } = replay(false);
    const slack = Object.values(r.reviews).find((x) => x.factId === "f-slack-price")!;
    expect(slack.closedBy).toBe("p-ada");
    expect(r.facts["f-slack-price"].versions.at(-1)?.by).toBe("p-ada");
  });

  it("tells the others, but not the person who decided", () => {
    const { r, log } = replay(false);
    const kinds = (id: string) => buildInbox(id, scoped(id, r), r, log).map((i) => `${i.kind}: ${i.text.slice(0, 20)}`);
    expect(kinds("p-viktor")).toContain("Accepted: Ada Mockridge accept");
    expect(kinds("p-ada").some((k) => k.startsWith("Accepted: Ada"))).toBe(false);
    expect(kinds("p-tess")).toContain("Kept old value: Raj Testwell kept 20");
  });
});

describe("notification inbox", () => {
  const { r, log } = replay();
  const inbox = (id: string) => buildInbox(id, scoped(id, r), r, log);

  it("asks reviewers to decide, with a link to the review", () => {
    const decide = inbox("p-ada").filter((i) => i.kind === "Needs your decision");
    expect(decide).toHaveLength(2);
    expect(decide.every((i) => i.actions[0].to.startsWith("/#review-"))).toBe(true);
  });

  it("links messages to the strategy and offers the decision when it is yours", () => {
    const m = inbox("p-ada").find((i) => i.kind === "Message" && i.text.includes("EUR/USD"))!;
    expect(m.actions.map((a) => a.label)).toEqual(["Decide now", "Open Mock Pricing Plan", "Open fact"]);
  });

  it("gives Mira her lease review and her automatic updates", () => {
    expect(inbox("p-mira").map((i) => i.kind).sort()).toEqual(["Needs your decision", "Updated", "Updated"]);
  });
});
