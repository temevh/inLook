import type { Fact, Strategy, Tier } from "../types";
import type { ClaimState } from "./fold";

export type Tone = "ok" | "warn" | "bad" | "low" | "quiet" | "primary";

export const TIER: Record<Tier, { label: string; tone: Tone }> = {
  high: { label: "High", tone: "bad" },
  medium: { label: "Medium", tone: "warn" },
  low: { label: "Low", tone: "low" },
};

export function factStatus(f: Fact): { label: string; tone: Tone } {
  if (f.status === "pending_review") return { label: "In review", tone: "warn" };
  if (f.status === "outdated") return { label: "Outdated", tone: "bad" };
  return { label: "Current", tone: "ok" };
}

export function strategyStatus(s: Strategy): { label: string; tone: Tone } {
  return s.status === "flagged" ? { label: "Flagged", tone: "bad" } : { label: "Healthy", tone: "ok" };
}

export const CLAIM: Record<ClaimState, { label: string; tone: Tone }> = {
  checking: { label: "Checking…", tone: "primary" },
  outdated: { label: "Outdated", tone: "bad" },
  current: { label: "Current", tone: "ok" },
  unverifiable: { label: "Unverifiable", tone: "quiet" },
  unverified: { label: "Unverified", tone: "quiet" },
};

export const EVENT_TONE: Record<string, Tone> = {
  "claim.spotted": "quiet", "claim.progress": "quiet", "claim.verdict": "bad", "claim.unverified": "quiet", "transcript.line": "quiet",
  "review.created": "warn", "review.closed": "ok", "fact.updated": "ok",
  "strategy.flagged": "bad", "strategy.healthy": "ok", "message.created": "low",
};
