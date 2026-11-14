// HUD: renders SSE events into cards and transcript lines. Skeleton rendering only.
import type { HudCard, InlookEvent } from "../../shared/contract";

const cards = document.getElementById("cards")!;
const transcript = document.getElementById("transcript")!;
const status = document.getElementById("status")!;
const MAX_CARDS = 8, MAX_LINES = 12;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function upsertCard(key: string, build: (card: HTMLElement) => void) {
  let card = cards.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!card) {
    card = el("article", "card");
    card.dataset.key = key;
    cards.prepend(card);
    while (cards.children.length > MAX_CARDS) cards.lastElementChild!.remove();
  }
  card.replaceChildren();
  card.className = "card";
  build(card);
}

const fillCard = (card: HTMLElement, c: HudCard, meta?: string) => {
  card.dataset.tier = c.criticality;
  card.append(el("h2", undefined, c.title), el("p", undefined, c.fact));
  if (meta) card.append(el("p", "meta", meta));
};

function render(e: InlookEvent) {
  switch (e.type) {
    case "transcript.line": {
      const line = el("p");
      line.append(el("b", undefined, `${e.payload.speaker}: `), e.payload.text);
      transcript.append(line);
      while (transcript.children.length > MAX_LINES) transcript.firstElementChild!.remove();
      break;
    }
    case "claim.spotted":
      upsertCard(e.payload.claimId, (c) => {
        c.classList.add("checking");
        c.append(el("h2", undefined, "checking…"), el("p", undefined, e.payload.text));
      });
      break;
    case "claim.unverified":
      upsertCard(e.payload.claimId, (c) => {
        c.classList.add("checking");
        c.append(el("h2", undefined, "Unverified"));
      });
      setTimeout(() => cards.querySelector(`[data-key="${CSS.escape(e.payload.claimId)}"]`)?.remove(), 4000);
      break;
    case "claim.verdict":
      upsertCard(e.payload.claimId, (c) => fillCard(c, e.payload.card, e.payload.evidence));
      break;
    case "fact.updated":
      upsertCard(`fact:${e.payload.factId}`, (c) => fillCard(c, e.payload.card));
      break;
    case "review.created":
      upsertCard(`review:${e.payload.reviewId}`, (c) => {
        fillCard(c, e.payload.card, e.payload.evidence);
        const actions = el("div", "actions");
        for (const decision of ["accept", "reject"] as const) {
          const b = el("button", undefined, decision === "accept" ? "Accept" : "Reject");
          b.onclick = () => void window.inlook.decideReview(e.payload.reviewId, decision);
          actions.append(b);
        }
        c.append(actions);
      });
      break;
    case "review.closed":
      cards.querySelector(`[data-key="${CSS.escape(`review:${e.payload.reviewId}`)}"]`)?.remove();
      break;
    case "strategy.flagged":
      upsertCard(`strategy:${e.payload.strategyId}`, (c) => {
        c.dataset.tier = "high";
        c.append(el("h2", undefined, "Strategy flagged"), el("p", undefined, e.payload.name));
      });
      break;
    case "strategy.healthy":
      cards.querySelector(`[data-key="${CSS.escape(`strategy:${e.payload.strategyId}`)}"]`)?.remove();
      break;
    case "message.created":
      upsertCard(`message:${e.payload.messageId}`, (c) =>
        c.append(el("h2", undefined, "Inlook message"), el("p", undefined, e.payload.text)));
      break;
  }
}

window.inlook.onEvent(render);
const applyState = (s: { hudInteractive: boolean; stream: string }) => {
  document.body.classList.toggle("interactive", s.hudInteractive);
  status.textContent = s.stream;
};
window.inlook.onState(applyState);
void window.inlook.getState().then(applyState);
