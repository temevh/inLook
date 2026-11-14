// Types come from shared/*.schema.json via `npm run gen:contract` (contract.gen.ts).
// Only what the schemas cannot express lives here. Change the contract in shared/ first.
import type { ClaimSpottedPayload, ClaimVerdictPayload, InlookEvent, ReviewRequest } from "./contract.gen";

export type {
  AcceptedResponse, CheckRequest, FactVersion, HudCard, InlookEvent, ReviewResponse, Tier,
} from "./contract.gen";

export type EventType = InlookEvent["type"];
/** Payload per event type, derived from the event union. */
export type EventPayloads = { [K in EventType]: Extract<InlookEvent, { type: K }>["payload"] };
export type ClaimSource = ClaimSpottedPayload["source"];
export type Verdict = ClaimVerdictPayload["verdict"];
export type ReviewDecision = ReviewRequest["decision"];

export const EVENT_TYPES = [
  "transcript.line", "claim.spotted", "claim.unverified", "claim.verdict", "fact.updated",
  "review.created", "review.closed", "strategy.flagged", "strategy.healthy", "message.created",
] as const satisfies readonly EventType[];
