// The notification inbox: what the signed-in person should hear about, each with links to act on it.
import type { InlookEvent, Records } from "../types";
import { clock, personName } from "./format";
import type { Tone } from "./labels";
import type { Scoped } from "./scope";

export interface InboxAction { label: string; to: string }
export interface InboxItem {
  key: string;
  at: string;
  kind: string;
  tone: Tone;
  meta: string;
  text: string;
  actions: InboxAction[];
}

export function buildInbox(viewer: string, scope: Scoped, r: Records, log: InlookEvent[]): InboxItem[] {
  const items: InboxItem[] = [];
  const myPending = (factId: string) =>
    Object.values(r.reviews).find((x) => x.factId === factId && x.status === "pending" && x.reviewers.includes(viewer));
  const label = (factId: string) => r.facts[factId]?.label ?? factId;

  // Decisions only you (or you and other owners) can make.
  for (const rev of Object.values(r.reviews)) {
    if (rev.status !== "pending" || !rev.reviewers.includes(viewer)) continue;
    items.push({
      key: `rv-${rev.id}`, at: rev.createdAt, kind: "Needs your decision", tone: "warn", meta: clock(rev.createdAt),
      text: `${label(rev.factId)}: ${rev.oldValue} → ${rev.newValue}. Accept the new value or keep the old one.`,
      actions: [{ label: "Decide now", to: `/#review-${rev.id}` }, { label: "Open fact", to: `/facts/${rev.factId}` }],
    });
  }

  // Strategy messages to you or your team.
  for (const m of scope.messages) {
    const toMe = m.to.includes(viewer);
    const pending = myPending(m.factId);
    const strategy = r.strategies[m.strategyId];
    items.push({
      key: `m-${m.id}`, at: m.at, kind: toMe ? "Message" : "Team message", tone: toMe ? "low" : "quiet",
      meta: `to ${m.to.map((id) => personName(id, r)).join(", ")} · ${clock(m.at)}`, text: m.text,
      actions: [
        ...(pending ? [{ label: "Decide now", to: `/#review-${pending.id}` }] : []),
        ...(strategy ? [{ label: `Open ${strategy.name}`, to: `/strategies#strategy-${strategy.id}` }] : []),
        { label: "Open fact", to: `/facts/${m.factId}` },
      ],
    });
  }

  // Reviews someone else decided: on facts in your scope, or ones you were asked about too.
  for (const e of log) {
    if (e.type !== "review.closed") continue;
    const rev = r.reviews[e.payload.reviewId];
    if (!rev || rev.closedBy === viewer || !(rev.reviewers.includes(viewer) || scope.facts.has(rev.factId))) continue;
    const who = rev.closedBy ? personName(rev.closedBy, r) : "A reviewer";
    const accepted = e.payload.status === "accepted";
    items.push({
      key: `d-${rev.id}`, at: e.at, kind: accepted ? "Accepted" : "Kept old value", tone: accepted ? "ok" : "quiet", meta: clock(e.at),
      text: accepted
        ? `${who} accepted ${label(rev.factId)}: ${rev.oldValue} → ${rev.newValue}.${rev.reviewers.includes(viewer) ? " You were asked too; nothing left for you to do." : ""}`
        : `${who} kept ${rev.oldValue} for ${label(rev.factId)} instead of ${rev.newValue}.`,
      actions: [{ label: "Version history", to: `/facts/${rev.factId}` }],
    });
  }

  // Facts in your scope that changed automatically, or that you accepted.
  for (const e of log) {
    if (e.type !== "fact.updated" || !scope.facts.has(e.payload.factId)) continue;
    const auto = e.payload.version.by === "inlook";
    // Someone else's accept is already an "Accepted" item above; only automatic updates and your own remain.
    if (!auto && e.payload.version.by !== viewer) continue;
    items.push({
      key: `u-${e.seq}`, at: e.at, kind: "Updated", tone: "ok", meta: clock(e.at),
      text: `${e.payload.card.fact} · ${auto ? "updated automatically by inLook (low tier, no review needed)" : "you accepted it"}`,
      actions: [{ label: "Version history", to: `/facts/${e.payload.factId}` }],
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
