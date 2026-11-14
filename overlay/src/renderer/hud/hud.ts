// HUD: renders SSE events into cards and transcript lines.
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

const keySel = (key: string) => `[data-key="${CSS.escape(key)}"]`;
const claimText = new Map<string, string>();

function upsertCard(key: string, build: (card: HTMLElement) => void) {
  let card = cards.querySelector<HTMLElement>(keySel(key));
  if (!card) {
    card = el("article", "card");
    card.dataset.key = key;
    cards.prepend(card);
    while (cards.children.length > MAX_CARDS) cards.lastElementChild!.remove();
  }
  card.replaceChildren();
  card.className = "card";
  delete card.dataset.tier;
  build(card);
}

const pill = (tier: string) => el("span", "pill", tier);

const head = (card: HTMLElement, title: string, tier?: string) => {
  const h = el("header", "head");
  h.append(el("h2", undefined, title));
  if (tier) { card.dataset.tier = tier; h.append(pill(tier)); }
  card.append(h);
};

/** Verdict first (title, criticality, fact line), then evidence. */
const fillCard = (card: HTMLElement, c: HudCard, evidence?: string) => {
  head(card, c.title, c.criticality);
  card.append(el("p", "fact", c.fact));
  if (evidence) card.append(el("p", "meta", evidence));
};

function unverified(claimId: string, reason: string) {
  upsertCard(claimId, (c) => {
    c.classList.add("unverified");
    head(c, "Unverified");
    const text = claimText.get(claimId);
    if (text) c.append(el("p", "fact", text));
    c.append(el("p", "meta", reason === "no_match" ? "No matching fact" : "Could not be checked"));
  });
  setTimeout(() => cards.querySelector(keySel(claimId))?.remove(), 4500);
}

function render(e: InlookEvent) {
  switch (e.type) {
    case "transcript.line": {
      const line = el("p");
      line.append(el("b", undefined, e.payload.speaker), e.payload.text);
      transcript.append(line);
      while (transcript.children.length > MAX_LINES) transcript.firstElementChild!.remove();
      break;
    }
    case "claim.spotted":
      claimText.set(e.payload.claimId, e.payload.text);
      upsertCard(e.payload.claimId, (c) => {
        c.classList.add("checking");
        c.append(el("header", "head"), el("p", "fact", e.payload.text));
        c.firstElementChild!.append(el("i", "dot"), el("h2", undefined, "Checking…"));
        c.append(el("p", "meta", `From ${e.payload.source}`));
      });
      break;
    case "claim.unverified":
      unverified(e.payload.claimId, e.payload.reason);
      break;
    case "claim.verdict": {
      const v = e.payload;
      if (v.verdict === "unverifiable") unverified(v.claimId, "unverifiable");
      else upsertCard(v.claimId, (c) => fillCard(c, v.card, v.evidence));
      break;
    }
    case "fact.updated":
      upsertCard(`fact:${e.payload.factId}`, (c) =>
        fillCard(c, e.payload.card, `Source: ${e.payload.version.source}`));
      break;
    case "review.created":
      upsertCard(`review:${e.payload.reviewId}`, (c) => {
        fillCard(c, e.payload.card, e.payload.evidence);
        const actions = el("div", "actions");
        for (const decision of ["accept", "reject"] as const) {
          const b = el("button", undefined, decision === "accept" ? "Accept" : "Reject");
          b.className = decision;
          b.onclick = () => {
            actions.querySelectorAll("button").forEach((x) => (x.disabled = true));
            void window.inlook.decideReview(e.payload.reviewId, decision);
          };
          actions.append(b);
        }
        c.append(actions);
      });
      break;
    case "review.closed":
      cards.querySelector(keySel(`review:${e.payload.reviewId}`))?.remove();
      break;
    case "strategy.flagged":
      upsertCard(`strategy:${e.payload.strategyId}`, (c) => {
        head(c, "Strategy flagged", "high");
        c.append(el("p", "fact", e.payload.name));
      });
      break;
    case "strategy.healthy":
      cards.querySelector(keySel(`strategy:${e.payload.strategyId}`))?.remove();
      break;
    case "message.created":
      upsertCard(`message:${e.payload.messageId}`, (c) => {
        c.classList.add("message");
        head(c, "Inlook");
        c.append(el("p", "fact", e.payload.text));
      });
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
