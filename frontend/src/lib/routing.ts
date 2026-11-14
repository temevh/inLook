// Plain-language explanations of the tier routing, so the dashboard can show why a change went where it did.
import type { Fact, Records } from "../types";
import { personName } from "./format";
import { effectiveTier } from "./scope";

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** What happens when this fact's source changes, step by step. */
export function ifChanged(fact: Fact, r: Records): string[] {
  const relying = Object.values(r.strategies).filter((s) => s.factIds.includes(fact.id));
  const tier = effectiveTier(fact.id, fact.tier, r.strategies);
  const stater = personName(fact.statedBy, r);
  const lines: string[] = [];
  if (fact.tier === "low" && tier === "medium") {
    lines.push(`Stated as low tier, but ${list(relying.map((s) => s.name))} ${relying.length > 1 ? "rely" : "relies"} on it, so it is treated as medium.`);
  }
  if (tier === "low") {
    lines.push("Low tier and no strategy relies on it: inLook updates the value automatically and adds a version.");
    return lines;
  }
  if (tier === "medium") {
    lines.push(`${stater}, who stated it, gets a review and decides.`);
    if (relying.length) lines.push("Medium tier flags no strategy, but a flagged strategy that uses this fact stays flagged until the review is closed.");
    return lines;
  }
  if (!relying.length) {
    lines.push(`High tier, but no strategy relies on it, so ${stater}, who stated it, decides.`);
    return lines;
  }
  const owners = [...new Set(relying.flatMap((s) => s.owners))].map((id) => personName(id, r));
  lines.push(`Every owner of a strategy that relies on it gets the review: ${list(owners)}. The first decision counts for everyone.`);
  lines.push(`${list(relying.map((s) => s.name))} ${relying.length > 1 ? "are" : "is"} flagged and each owner gets a message.`);
  lines.push("A flagged strategy turns healthy again once none of its facts is in review.");
  return lines;
}

/** One sentence for a review card: why this person (or these people) decide. */
export function whyReviewer(fact: Fact | undefined, tier: string, reviewers: string[], r: Records): string {
  if (!fact) return "";
  const relying = Object.values(r.strategies).filter((s) => s.factIds.includes(fact.id));
  const who = list(reviewers.map((id) => personName(id, r)));
  if (tier === "high" && relying.length) {
    return `High tier: ${list(relying.map((s) => s.name))} ${relying.length > 1 ? "rely" : "relies"} on this, so ${reviewers.length > 1 ? `their owners (${who}) decide. The first decision counts` : `${who} decides`}.`;
  }
  if (tier === "high") return `High tier, but no strategy relies on it, so ${who}, who stated it, decides.`;
  if (fact.tier === "low") return `Stated as low tier, but a strategy relies on it, so it needs a review. ${who} stated it, so they decide.`;
  return `Medium tier: ${who} stated this fact, so they decide.`;
}
