// Who sees what: a person's scope is themselves plus everyone below them in the reporting line.
import type { Message, Person, Records, Review, Strategy } from "../types";

export function scopeOf(viewer: string, people: Record<string, Person>): Set<string> {
  const out = new Set<string>([viewer]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of Object.values(people)) {
      if (p.reportsTo && out.has(p.reportsTo) && !out.has(p.id)) { out.add(p.id); grew = true; }
    }
  }
  return out;
}

/** People in tree order (depth first from the top), with their depth. */
export function orgTree(people: Record<string, Person>): { person: Person; depth: number }[] {
  const all = Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
  const out: { person: Person; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of all.filter((x) => (x.reportsTo ?? null) === parent || (parent === null && x.reportsTo && !people[x.reportsTo]))) {
      out.push({ person: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface Scoped {
  team: Set<string>;
  /** Facts in scope: stated by someone in the team, or behind a strategy the team owns. */
  facts: Set<string>;
  /** Facts the viewer is personally part of. */
  ownFacts: Set<string>;
  strategies: Strategy[];
  reviews: Review[];
  messages: Message[];
}

export function scoped(viewer: string, r: Records): Scoped {
  const team = scopeOf(viewer, r.people);
  const inTeam = (ids: string[]) => ids.some((id) => team.has(id));
  const facts = new Set<string>();
  const ownFacts = new Set<string>();
  for (const f of Object.values(r.facts)) {
    if (team.has(f.statedBy)) facts.add(f.id);
    if (f.statedBy === viewer) ownFacts.add(f.id);
  }
  const strategies = Object.values(r.strategies).filter((s) => inTeam(s.owners));
  for (const s of strategies) {
    for (const id of s.factIds) {
      facts.add(id);
      if (s.owners.includes(viewer)) ownFacts.add(id);
    }
  }
  const reviews = Object.values(r.reviews).filter((x) => inTeam(x.reviewers) || facts.has(x.factId));
  const messages = Object.values(r.messages).filter((m) => inTeam(m.to));
  return { team, facts, ownFacts, strategies, reviews, messages };
}

/** Facts any strategy relies on are reported as at least medium, as the backend does. */
export function effectiveTier(factId: string, tier: "low" | "medium" | "high", strategies: Record<string, Strategy>) {
  if (tier !== "low") return tier;
  return Object.values(strategies).some((s) => s.factIds.includes(factId)) ? "medium" : "low";
}
