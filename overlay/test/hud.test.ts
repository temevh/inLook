// HUD logic without DOM: eviction order, change text, status wording, hotkey labels. Runs the built code in dist/web (see `pretest`).
import { describe, expect, it } from "vitest";
import {
  compactChange, domainOf, evictionTarget, factLabel, initials, isFiller, keycaps, numberParts, rankOf, rollFrame,
  splitChange, statusOf, type CardInfo,
} from "../dist/web/renderer/hud/policy.js";

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

describe("compactChange", () => {
  it("moves the words both values end with into a unit", () => {
    expect(compactChange("$8 per seat per month", "$10 per seat per month")).toEqual({ old: "$8", new: "$10", unit: "per seat per month" });
    expect(compactChange("€59 per seat", "€39 per seat")).toEqual({ old: "€59", new: "€39", unit: "per seat" });
  });
  it("leaves values whole when more than one token differs, or nothing is shared", () => {
    expect(compactChange("30 days", "14 calendar days")).toEqual({ old: "30 days", new: "14 calendar days", unit: "" });
    expect(compactChange("MockNet", "MockNet-5G")).toEqual({ old: "MockNet", new: "MockNet-5G", unit: "" });
    expect(compactChange("per seat", "per seat")).toEqual({ old: "per seat", new: "per seat", unit: "" });
  });
});

describe("rolling a number", () => {
  it("reads one number with its affixes", () => {
    expect(numberParts("$10")).toEqual({ prefix: "$", value: 10, decimals: 0, suffix: "" });
    expect(numberParts("3.5%")).toEqual({ prefix: "", value: 3.5, decimals: 1, suffix: "%" });
    for (const text of ["MockNet", "14 calendar 2", ""]) expect(numberParts(text)).toBeNull();
  });
  it("rolls between values that look alike, and only those", () => {
    expect(rollFrame("$8", "$10", 0)).toBe("$8");
    expect(rollFrame("$8", "$10", 0.5)).toBe("$9");
    expect(rollFrame("$8", "$10", 1)).toBe("$10");
    expect(rollFrame("3%", "3.5%", 1)).toBe("3.5%");
    expect(rollFrame("$8", "€10", 0.5)).toBeNull();
    expect(rollFrame("MockNet", "MockNet-5G", 0.5)).toBeNull();
  });
});

describe("wording", () => {
  it("says the connection and mic state in the user's words", () => {
    const s = (stream: string, transcribing = false, audio = "off") => statusOf({ stream, transcribing, audio });
    expect(s("closed", true, "live")).toEqual({ text: "Offline", tone: "off" });
    expect(s("connecting")).toEqual({ text: "Connecting…", tone: "wait" });
    expect(s("open")).toEqual({ text: "Live", tone: "live" });
    expect(s("open", true, "live")).toEqual({ text: "Listening", tone: "listening" });
    expect(s("open", true, "connecting").tone).toBe("wait");
    expect(s("open", true, "reconnecting").text).toBe("Mic reconnecting…");
  });
  it("spots transcript lines with nothing to read", () => {
    for (const text of ["Uh", "Yes.", "Inspiration.", "  "]) expect(isFiller(text)).toBe(true);
    for (const text of ["Okay, pricing slide.", "$8", "Easily compete"]) expect(isFiller(text)).toBe(false);
  });
  it("shortens sources, names and hotkeys", () => {
    expect(domainOf("https://www.notion.com/pricing")).toBe("notion.com");
    expect(domainOf("https://apple.com/shop/help/returns_refund")).toBe("apple.com");
    for (const bad of [null, undefined, "", "not a url"]) expect(domainOf(bad)).toBe("");
    expect(initials("Ada Mockridge")).toBe("AM");
    expect(initials("  sam  ")).toBe("S");
    expect(initials("Anna Maria Virtanen")).toBe("AV");
    expect(keycaps("CommandOrControl+Alt+A")).toEqual(["Ctrl", "Alt", "A"]);
    expect(keycaps("")).toEqual([]);
  });
});

describe("factLabel", () => {
  it("names the fact from a change line, a still-current line, or returns the text", () => {
    expect(factLabel("Notion Plus price per seat: $8 per seat per month → $10 per seat per month")).toBe("Notion Plus price per seat");
    expect(factLabel("Notion Plus price per seat: $10 per seat per month (still current)", "$10 per seat per month")).toBe("Notion Plus price per seat");
    expect(factLabel("Mock Pricing Plan", "$10")).toBe("Mock Pricing Plan");
    expect(factLabel("Plan: Plus: $10 (still current)", "$10")).toBe("Plan: Plus");
  });
});
