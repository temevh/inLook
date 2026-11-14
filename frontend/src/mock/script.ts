// MOCK DATA: the meeting that Play meeting replays, from demo-data.json.
// Each line is said in the meeting; a line with a claim is then checked like any other claim.
import data from "./demo-data.json";
import type { Source } from "../data/demo";

export interface MeetingLine {
  delayMs: number;
  speaker: string;
  line: string;
  claim?: {
    factId: string | null;
    text: string;
    source?: Source;
    /** Someone else decides the review this claim opens, after afterMs, unless they are signed in. */
    autoDecide?: { by: string; decision: "accept" | "reject"; afterMs: number };
  };
}

export const MEETING = data.meeting as MeetingLine[];
