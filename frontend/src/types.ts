// Event types come from the shared contract (generated from shared/*.schema.json).
// Record types mirror the Prisma models in prisma/schema.prisma, as /api/* returns them.
import type { FactVersion, InlookEvent, Tier } from "../../overlay/src/shared/contract.gen";

export type { FactVersion, HudCard, InlookEvent, Tier } from "../../overlay/src/shared/contract.gen";
export type EventType = InlookEvent["type"];

export interface Person {
  id: string;
  name: string;
  role: string;
  team?: string;
  /** Person id of their manager. Not in the database yet: filled from src/mock/org.ts. */
  reportsTo: string | null;
}

export interface Fact {
  id: string;
  key: string;
  label: string;
  value: string;
  tier: Tier;
  sourceUrl: string | null;
  statedBy: string;
  status: "current" | "outdated" | "pending_review";
  versions: FactVersion[];
}

export interface Strategy {
  id: string;
  name: string;
  owners: string[];
  factIds: string[];
  status: "healthy" | "flagged";
  /** What the strategy is, in one line. Not in the database: demo data only. */
  summary?: string;
}

export interface Review {
  id: string;
  factId: string;
  oldValue: string;
  newValue: string;
  evidence: string;
  tier: Tier;
  reviewers: string[];
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  closedAt?: string | null;
  closedBy?: string | null;
}

export interface Message {
  id: string;
  to: string[];
  strategyId: string;
  factId: string;
  text: string;
  at: string;
}

/** Everything the dashboard folds events into. */
export interface Records {
  people: Record<string, Person>;
  facts: Record<string, Fact>;
  strategies: Record<string, Strategy>;
  reviews: Record<string, Review>;
  messages: Record<string, Message>;
}

export interface Snapshot extends Records {
  /** Newest events first, as /api/events returns them. */
  events: InlookEvent[];
}

export type DataMode = "live" | "demo";
export type Connection = "connecting" | "live" | "reconnecting" | "offline";
