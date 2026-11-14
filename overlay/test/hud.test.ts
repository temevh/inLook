// HUD card policy (no DOM): eviction order and fact-card reuse. Runs the built code in dist/web (see `pretest`).
import { describe, expect, it } from "vitest";
import { evictionTarget, FactCards, rankOf, splitChange, type CardInfo } from "../dist/web/renderer/hud/policy.js";

const low: CardInfo = { kind: "claim", tier: "low" };
const medium: CardInfo = { kind: "claim", tier: "medium" };
const high: CardInfo = { kind: "claim", tier: "high" };
const strategy: CardInfo = { kind: "strategy", tier: "high" };
const message: CardInfo = { kind: "message" };
const pending: CardInfo = { kind: "review", tier: "high" };
const closed: CardInfo = { kind: "review", tier: "medium", resolved: true };
const unverified: CardInfo = { kind: "claim", unverified: true };
const pick = (stack: CardInfo[]) => evictionTarget(stack.map(rankOf));

describe("eviction", () => {
  it("drops low before medium before high, oldest among equals (index 0 is the newest)", () => {
    expect(pick([high, medium, low, low])).toBe(3);
    expect(pick([high, high, medium, high, low, medium])).toBe(4);
    expect(pick([low, high, medium, high])).toBe(2);
    expect(pick([medium, unverified, high])).toBe(1);
  });
  it("keeps flagged strategies, messages and pending reviews while anything else can go", () => {
    expect(pick([low, message, strategy, pending, high])).toBe(4);
    expect(pick([low, message, strategy, pending, closed])).toBe(4);
    expect(pick([low, message, strategy, pending])).toBe(2); // strategies and messages go last; oldest first
  });
  it("never drops the newest card or a pending review", () => {
    expect(pick([low])).toBe(-1);
    expect(pick([high, pending, pending])).toBe(-1);
  });
});

describe("FactCards", () => {
  const usable = () => true;
  it("reuses the verdict card of the same fact, else the event's own key", () => {
    const f = new FactCards();
    f.verdict("f1", "c1");
    expect(f.keyFor("f1", "fact:f1", usable)).toBe("c1");
    expect(f.keyFor("f2", "fact:f2", usable)).toBe("fact:f2");
    expect(f.keyFor("f1", "fact:f1", () => false)).toBe("fact:f1");
  });
  it("points a fact at its latest verdict card and forgets the oldest past the cap", () => {
    const f = new FactCards(2);
    f.verdict("f1", "c1"); f.verdict("f1", "c2"); f.verdict("f2", "c3"); f.verdict("f3", "c4");
    expect(f.keyFor("f1", "own", usable)).toBe("own");
    expect(f.keyFor("f3", "own", usable)).toBe("c4");
  });
});

describe("splitChange", () => {
  it("splits the backend's change text into label, old and new value", () => {
    expect(splitChange("Notion Plus price per seat: $8 per seat per month → $10 per seat per month")).toEqual(
      { label: "Notion Plus price per seat", old: "$8 per seat per month", new: "$10 per seat per month" });
    expect(splitChange("Office wifi: MockNet → MockNet-5G")).toEqual({ label: "Office wifi", old: "MockNet", new: "MockNet-5G" });
  });
  it("uses the last colon before the arrow, so a label with a colon still works", () => {
    expect(splitChange("Plan: Plus price: $8 → $10")).toEqual({ label: "Plan: Plus price", old: "$8", new: "$10" });
  });
  it("returns null for text that is not a change", () => {
    for (const text of ["Mock Pricing Plan", "Price → $10", "Price: $8", ": $8 → $10", "Price: $8 → "]) expect(splitChange(text)).toBeNull();
  });
});
