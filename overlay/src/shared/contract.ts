// Mirror of shared/CONTRACT.md. Change the contract there first.
// "proposed" shapes are skeleton guesses to agree with the backend owners.

export type Tier = "low" | "medium" | "high";

/** HUD card, filled by Gemini (shared/card.schema.json). decided */
export interface HudCard {
  title: "Fact outdated" | "Fact updated" | "Needs review";
  /** Copied from the fact's stored tier; the backend checks it before sending. */
  criticality: Tier;
  /** One line, e.g. "Competitor X: €59 → €39 per seat". */
  fact: string;
}

export type ClaimSource = "audio" | "selection" | "screenshot";
export type Verdict = "current" | "outdated" | "unverifiable";

export interface FactVersion { value: string; source: string; at: string; by: string }

/** Payload per event type. Only claim.spotted and claim.verdict are named in the spec; the rest are proposed. */
export interface EventPayloads {
  "transcript.line": { lineId: string; speaker: string; text: string };
  "claim.spotted": { claimId: string; text: string; source: ClaimSource; lineId?: string };
  "claim.unverified": { claimId: string; reason: "no_match" | "unverifiable" };
  "claim.verdict": {
    claimId: string; factId: string; verdict: Verdict;
    oldValue: string; newValue?: string; evidence: string; sourceUrl?: string; card: HudCard;
  };
  "fact.updated": { factId: string; version: FactVersion; card: HudCard };
  "review.created": {
    reviewId: string; factId: string; oldValue: string; newValue: string;
    evidence: string; tier: Tier; reviewers: string[]; card: HudCard;
  };
  "review.closed": { reviewId: string; factId: string; status: "accepted" | "rejected" };
  "strategy.flagged": { strategyId: string; name: string; factId: string };
  "strategy.healthy": { strategyId: string; name: string };
  "message.created": { messageId: string; to: string[]; strategyId: string; factId: string; text: string };
}

export type EventType = keyof EventPayloads;

/** SSE envelope: { seq, type, payload, at }. decided */
export type InlookEvent = {
  [K in EventType]: { seq: number; type: K; payload: EventPayloads[K]; at: string };
}[EventType];

export const EVENT_TYPES = [
  "transcript.line", "claim.spotted", "claim.unverified", "claim.verdict", "fact.updated",
  "review.created", "review.closed", "strategy.flagged", "strategy.healthy", "message.created",
] as const satisfies readonly EventType[];

// ---- Requests (bodies proposed) ----

export type CheckRequest =
  | { kind: "text"; text: string; source: "selection" | "claim" }
  | { kind: "image"; mime: "image/png"; dataBase64: string; source: "screenshot" };

export interface AudioChunk {
  /** audio/webm;codecs=opus, standalone file (own header). */
  data: ArrayBuffer;
  mime: string;
  startedAt: string;
  seqNo: number;
}

export type ReviewDecision = "accept" | "reject";

export interface AcceptedResponse { accepted: true; checkId?: string }
export interface ReviewResponse { id: string; status: "accepted" | "rejected" }
