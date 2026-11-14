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
const claimText = new Map<string, string>(); // claim text for the unverified card; dropped once the claim resolves
const CLAIM_TEXT_MAX = 100;
const timers = new Map<string, number>(); // per card key: delayed dismissals, cancelled when the key is updated

// Motion: transform/opacity only. Reduced motion keeps short opacity fades, no movement.
const EASE = "cubic-bezier(.22, 1, .36, 1)";
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const glides = new WeakMap<Element, Animation>();
const leaving = new WeakMap<HTMLElement, Animation>();

/** Run a DOM change; cards and transcript lines that end up elsewhere glide from where they were (FLIP). */
function flip(mutate: () => void) {
  if (calm.matches) return mutate();
  const items = [...document.querySelectorAll(".card, .transcript p")];
  const before = new Map(items.map((n) => [n, n.getBoundingClientRect().top]));
  items.forEach((n) => glides.get(n)?.cancel());
  mutate();
  for (const [n, top] of before) {
    const dy = top - n.getBoundingClientRect().top;
    if (n.isConnected && Math.abs(dy) > 0.5)
      glides.set(n, n.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 380, easing: EASE }));
  }
}

const enter = (card: HTMLElement) =>
  card.animate(
    [{ opacity: 0, transform: calm.matches ? "none" : "translateY(-8px) scale(.985)" }, { opacity: 1, transform: "none" }],
    { duration: calm.matches ? 150 : 380, easing: EASE });

/** Run `fn` later for this card key; any update of the key cancels it, so a late verdict is never removed by an old timer. */
function later(key: string, ms: number, fn: () => void) {
  clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(() => { timers.delete(key); fn(); }, ms));
}

/** Keep every card fully visible: drop the oldest finished cards until the stack fits.
 *  Cards waiting for a review decision are never dropped. */
function fit() {
  while (cards.children.length > MAX_CARDS || cards.scrollHeight > cards.clientHeight + 1) {
    const oldest = [...cards.children].slice(1).reverse()
      .find((c) => !c.classList.contains("review") || c.classList.contains("resolved"));
    if (!oldest) break;
    oldest.remove();
  }
}

/** Fade a card out (exits are faster than entrances), then drop it and close the gap. */
function dismiss(key: string, ms = 180) {
  const card = cards.querySelector<HTMLElement>(keySel(key));
  if (!card || leaving.has(card)) return;
  const exit = card.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: calm.matches ? "none" : "scale(.97)" }],
    { duration: ms, easing: EASE, fill: "forwards" });
  leaving.set(card, exit);
  exit.finished.then(() => { if (leaving.get(card) === exit) flip(() => card.remove()); }, () => {});
}

function upsertCard(key: string, build: (card: HTMLElement) => void) {
  clearTimeout(timers.get(key));
  timers.delete(key);
  flip(() => {
    let card = cards.querySelector<HTMLElement>(keySel(key));
    const fresh = !card;
    if (card) {
      leaving.get(card)?.cancel(); // a late event revives a card that was on its way out
      leaving.delete(card);
    } else {
      card = el("article", "card");
      card.dataset.key = key;
      cards.prepend(card);
    }
    card.replaceChildren();
    card.className = fresh ? "card" : "card swap"; // swap: content rises in on the card that stays
    delete card.dataset.tier;
    build(card);
    // Verdict-style cards land with one ring pulse; checking and unverified stay quiet.
    if (!card.classList.contains("checking") && !card.classList.contains("unverified")) card.classList.add("land");
    fit();
    if (fresh) enter(card);
  });
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
    claimText.delete(claimId);
    if (text) c.append(el("p", "fact", text));
    c.append(el("p", "meta", reason === "no_match" ? "No matching fact" : "Could not be checked"));
  });
  later(claimId, 3800, () => dismiss(claimId, 700));
}

/** Accept / Reject. Shows sending → sent, or the failure with the buttons live again so the click can be retried. */
function reviewActions(reviewId: string) {
  const wrap = el("div", "actions");
  const buttons = (["accept", "reject"] as const).map((decision) => {
    const b = el("button", decision, decision === "accept" ? "Accept" : "Reject");
    b.onclick = async () => {
      buttons.forEach((x) => (x.disabled = true));
      b.classList.add("chosen");
      setStatus("Sending…");
      let r: { ok: boolean; error?: string };
      try { r = await window.inlook.decideReview(reviewId, decision); }
      catch (err) { r = { ok: false, error: (err as Error).message }; }
      if (r.ok) { setStatus("Sent"); return; } // the card closes on review.closed
      b.classList.remove("chosen");
      buttons.forEach((x) => (x.disabled = false));
      setStatus(`Not sent${r.error ? `: ${r.error}` : ""}. Try again.`, true);
    };
    return b;
  });
  const line = el("p", "meta sendstate");
  line.setAttribute("role", "status");
  const setStatus = (text: string, error = false) => flip(() => {
    line.textContent = text;
    line.classList.toggle("error", error);
    if (!line.isConnected) wrap.after(line);
    fit();
  });
  wrap.append(...buttons);
  return wrap;
}

function render(e: InlookEvent) {
  switch (e.type) {
    case "transcript.line": {
      const line = el("p");
      line.append(el("b", undefined, e.payload.speaker), e.payload.text);
      flip(() => {
        transcript.append(line);
        while (transcript.children.length > MAX_LINES) transcript.firstElementChild!.remove();
        fit(); // a taller transcript leaves the cards less room
      });
      break;
    }
    case "claim.spotted":
      claimText.set(e.payload.claimId, e.payload.text);
      if (claimText.size > CLAIM_TEXT_MAX) claimText.delete(claimText.keys().next().value!);
      upsertCard(e.payload.claimId, (c) => {
        c.classList.add("checking");
        c.append(el("header", "head"), el("p", "fact", e.payload.text));
        c.firstElementChild!.append(el("i", "dot"), el("h2", undefined, "Checking…"));
        c.append(el("p", "meta source", `From ${e.payload.source}`));
      });
      break;
    case "claim.unverified":
      unverified(e.payload.claimId, e.payload.reason);
      break;
    case "claim.verdict": {
      const v = e.payload;
      if (v.verdict === "unverifiable") unverified(v.claimId, "unverifiable");
      else { claimText.delete(v.claimId); upsertCard(v.claimId, (c) => fillCard(c, v.card, v.evidence)); }
      break;
    }
    case "fact.updated":
      upsertCard(`fact:${e.payload.factId}`, (c) =>
        fillCard(c, e.payload.card, `Source: ${e.payload.version.source}`));
      break;
    case "review.created":
      upsertCard(`review:${e.payload.reviewId}`, (c) => {
        c.classList.add("review");
        fillCard(c, e.payload.card, e.payload.evidence);
        c.append(reviewActions(e.payload.reviewId));
      });
      break;
    case "review.closed": {
      // Show the outcome the event carries for a moment, then close the card.
      const key = `review:${e.payload.reviewId}`;
      const card = cards.querySelector<HTMLElement>(keySel(key));
      if (!card) break;
      flip(() => {
        card.classList.add("resolved");
        card.querySelector(".actions")?.replaceWith(el("p", `result ${e.payload.status}`, e.payload.status === "accepted" ? "Accepted" : "Rejected"));
        card.querySelector(".sendstate")?.remove();
        fit();
      });
      later(key, 1400, () => dismiss(key));
      break;
    }
    case "strategy.flagged":
      upsertCard(`strategy:${e.payload.strategyId}`, (c) => {
        head(c, "Strategy flagged", "high");
        c.append(el("p", "fact", e.payload.name));
      });
      break;
    case "strategy.healthy":
      dismiss(`strategy:${e.payload.strategyId}`);
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
  status.textContent = s.hudInteractive ? `${s.stream} · interactive` : s.stream;
  status.dataset.stream = s.stream;
};
window.inlook.onState(applyState);
void window.inlook.getState().then(applyState);
