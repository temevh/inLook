// HUD: renders SSE events into a short live transcript and one card per fact.
//
// One fact, one card, from "Checking" to its outcome: the verdict, the review, the strategies it affects and
// the people who were told all land on the same card (FactView below), and Accept / Reject turn that card
// into the outcome before it fades. The HUD is quiet when nothing is happening: the header and transcript
// only show while there is something to say. Whatever it draws is clickable; the rest of the strip is
// click-through (the window shape follows `reportExtent`).
import type { InlookEvent, Person, ReviewRequest, Tier } from "../../shared/contract.gen";
import type { Hotkeys, OverlayState } from "../../shared/ipc";
import {
  compactChange, domainOf, evictionTarget, factLabel, initials, isFiller, keycaps, rankOf, rollFrame, splitChange, statusOf,
  type CardInfo,
} from "./policy.js";

const strip = document.querySelector<HTMLElement>(".strip")!;
const bar = document.getElementById("bar")!;
const cards = document.getElementById("cards")!;
const transcript = document.getElementById("transcript")!;
const status = document.getElementById("status")!;
const statusText = document.getElementById("status-text")!;
const meter = document.getElementById("meter")!;

const MAX_CARDS = 6, MAX_LINES = 3;
const MAP_MAX = 100; // per bookkeeping map; the oldest entry goes first
// How long an outcome stays readable before its card fades.
const UPDATED_MS = 4000, KEPT_MS = 2200, AUTO_UPDATED_MS = 5000, CONFIRMED_MS = 4000, OUTCOME_FADE_MS = 450;
const TRANSCRIPT_IDLE_MS = 20_000; // the transcript leaves this long after the last line, unless the mic is on
const SHADOW_PX = 18; // room below the last element for its shadow, inside the clickable shape

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const keySel = (key: string) => `[data-key="${CSS.escape(key)}"]`;
const cardAt = (key: string) => cards.querySelector<HTMLElement>(keySel(key));
function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAP_MAX) map.delete(map.keys().next().value!);
}

// --- state ---------------------------------------------------------------------------------------

type Phase = "outdated" | "review" | "confirmed" | "updated" | "kept";
/** Everything the HUD knows about one fact's current change; rendered as one card. */
interface FactView {
  factId: string; key: string; phase: Phase; tier: Tier;
  label: string; old: string; new: string;
  sourceUrl?: string | null; evidence?: string; checkedAt?: string;
  reviewId?: string; reviewers: Person[]; notified: Person[];
  strategies: Map<string, { name: string; healthy: boolean }>;
  outcome?: string; // the line under an updated card ("Accepted · saved as the current value")
}
const facts = new Map<string, FactView>();
const claims = new Map<string, { text: string; source: string; lineId?: string | null }>();
const strategyFact = new Map<string, string>(); // strategyId → factId it was flagged for
const timers = new Map<string, number>(); // per card key: delayed dismissals, cancelled when the key is updated
let hotkeys: Hotkeys = { check: "", accept: "", reject: "" };
let overlay: Pick<OverlayState, "stream" | "transcribing" | "audio"> = { stream: "connecting", transcribing: false, audio: "off" };
let lastLineAt = 0, transcriptTimer = 0;

// --- motion: transform/opacity only. Reduced motion keeps short opacity fades, no movement. --------

const EASE = "cubic-bezier(.22, 1, .36, 1)";
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const glides = new WeakMap<Element, Animation>();
const leaving = new WeakMap<HTMLElement, Animation>();

/** Run a DOM change; cards and transcript lines that end up elsewhere glide from where they were (FLIP). */
function flip(mutate: () => void) {
  if (calm.matches) { mutate(); refreshChrome(); return; }
  // Only what is on screen now can glide; the header and transcript fade in on their own when they appear.
  const items = [...document.querySelectorAll<HTMLElement>(".card, .transcript p, .transcript, .bar")].filter((n) => n.offsetParent);
  const before = new Map(items.map((n) => [n, n.getBoundingClientRect().top]));
  items.forEach((n) => glides.get(n)?.cancel());
  mutate();
  refreshChrome();
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

/** Run `fn` later for this card key; any update of the key cancels it, so a late event is never undone by an old timer. */
function later(key: string, ms: number, fn: () => void) {
  clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(() => { timers.delete(key); fn(); }, ms));
}

const cardInfo = (c: Element): CardInfo => {
  const key = (c as HTMLElement).dataset.key ?? "", has = (cls: string) => c.classList.contains(cls);
  return {
    tier: (c as HTMLElement).dataset.tier,
    kind: has("review") ? "review" : key.startsWith("strategy:") ? "strategy" : has("message") ? "message" : "claim",
    resolved: false, unverified: has("unverified"),
  };
};

/** Keep every card fully visible. When space runs out, drop the least important first: older transcript lines,
 *  then low, then medium, then high cards, then strategies and messages. Pending reviews are never dropped. */
function fit() {
  while (cards.children.length > MAX_CARDS || cards.scrollHeight > cards.clientHeight + 1) {
    if (cards.children.length <= MAX_CARDS && transcript.children.length > 1) { transcript.firstElementChild!.remove(); continue; }
    const i = evictionTarget([...cards.children].map((c) => rankOf(cardInfo(c))));
    if (i < 0) break;
    cards.children[i]!.remove();
  }
}

/** Fade a card out (exits are faster than entrances), then drop it and close the gap. */
function dismiss(key: string, ms = 180) {
  const card = cardAt(key);
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
    let card = cardAt(key);
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
    // Cards that carry news land with one ring pulse; checking, unverified and kept stay quiet.
    if (!["checking", "unverified", "kept"].some((c) => card!.classList.contains(c))) card.classList.add("land");
    fit();
    if (fresh) enter(card);
  });
}

// --- quiet chrome and the clickable shape ------------------------------------------------------------

/** Header and transcript only show while there is something to say; at rest the strip is empty. */
function refreshChrome() {
  const { text, tone } = statusOf(overlay);
  statusText.textContent = text;
  status.dataset.tone = tone;
  const recent = Date.now() - lastLineAt < TRANSCRIPT_IDLE_MS;
  transcript.hidden = !(transcript.children.length && (overlay.transcribing || recent));
  bar.hidden = !(cards.children.length || !transcript.hidden || tone !== "live");
}

let extentFrame = 0;
/** Tell main how far down the strip draws, so exactly that part takes the mouse and the rest is click-through. */
function reportExtent() {
  if (extentFrame) return;
  extentFrame = requestAnimationFrame(() => {
    extentFrame = 0;
    // Layout positions (offsetTop), not getBoundingClientRect: a card that is gliding or fading in is measured
    // where it will end up, so the shape never clips it.
    const shown = ([bar, transcript, ...cards.children] as HTMLElement[]).filter((n) => !n.hidden);
    const bottom = Math.max(0, ...shown.map((n) => n.offsetTop + n.offsetHeight));
    void window.inlook.setHudExtent(bottom > 0 ? bottom + SHADOW_PX : 0).catch(() => {});
  });
}
new MutationObserver(reportExtent).observe(strip, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"] });
void document.fonts.ready.then(reportExtent);

// --- building blocks ---------------------------------------------------------------------------------

const titleRow = (card: HTMLElement, title: string, mark?: "dot" | "tick") => {
  const h = el("header", "head"), t = el("h2");
  if (mark) t.append(el("i", mark));
  t.append(title);
  h.append(t);
  card.append(h);
  return h;
};

const person = (p: Person, withRole = false) => {
  const chip = el("span", "person");
  chip.append(el("i", "avatar", initials(p.name)), p.name);
  if (withRole && p.role) chip.append(el("span", "role", p.role));
  chip.title = p.role ? `${p.name} · ${p.role}` : p.name;
  return chip;
};

const row = (label: string, ...items: (Node | string)[]) => {
  const r = el("p", "row");
  r.append(el("span", "row-label", label), ...items);
  return r;
};

const clock = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
};

/** The change itself, as large as anything on the strip: "$8 → $10", with the shared unit beside it. */
function changeLine(v: FactView, roll: boolean) {
  const p = el("p", "change"), c = compactChange(v.old, v.new);
  if (v.phase === "confirmed" || v.phase === "kept") {
    p.append(el("strong", "value", v.old));
    return p;
  }
  const fresh = el("strong", "new", c.new);
  p.append(el(v.phase === "updated" ? "s" : "span", "old", c.old), el("span", "arrow", "→"), fresh);
  if (c.unit) p.append(el("span", "unit", c.unit));
  if (roll && !calm.matches && rollFrame(c.old, c.new, 0) !== null) {
    // The number rolls from the old value to the new one: the moment the product exists for.
    const start = performance.now() + 120, ms = 700;
    fresh.textContent = c.old;
    const step = (now: number) => {
      if (!fresh.isConnected) return;
      const t = Math.max(0, Math.min(1, (now - start) / ms));
      fresh.textContent = rollFrame(c.old, c.new, 1 - (1 - t) ** 3) ?? c.new;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return p;
}

/** Where the new value comes from: the source as a chip with the time it was read, then the words found there. */
function sourceLine(v: FactView) {
  const domain = domainOf(v.sourceUrl);
  if (!domain && !v.evidence) return null;
  const p = el("p", "source");
  if (domain) p.append(el("span", "chip", `${domain} · ${clock(v.checkedAt)}`));
  if (v.evidence) p.append(el("q", "evidence", v.evidence));
  return p;
}

/** Who and what this change touches: the strategies that rely on the fact, and the people asked or told. */
function extras(v: FactView) {
  const box = el("div", "extras");
  const flagged = [...v.strategies.values()];
  if (v.phase === "updated") {
    for (const s of flagged.filter((x) => x.healthy)) box.append(row("", el("span", "healed", `${s.name} is healthy again`)));
    return box;
  }
  if (flagged.length) box.append(row("Affects", ...flagged.map((s) => el("span", "strategy", s.name))));
  const asked = new Set(v.reviewers.map((p) => p.id));
  if (v.reviewers.length) {
    const told = v.reviewers.length > 0 && v.reviewers.every((p) => v.notified.some((n) => n.id === p.id));
    box.append(row("Review by", ...v.reviewers.map((p) => person(p, true)), ...(told ? [el("span", "told", "notified")] : [])));
  }
  const others = v.notified.filter((p) => !asked.has(p.id));
  if (others.length) box.append(row("Notified", ...others.map((p) => person(p, true))));
  return box;
}

const keyHint = (accelerator: string) => {
  const k = el("kbd");
  k.append(...keycaps(accelerator).map((c) => el("span", undefined, c)));
  return k;
};

/** Accept / Reject, by click or by hotkey. Shows sending → sent, or the failure with the buttons live again. */
function reviewActions(reviewId: string) {
  const wrap = el("div", "actions");
  const buttons = (["accept", "reject"] as const).map((decision) => {
    const b = el("button", decision);
    b.dataset.decision = decision;
    b.append(el("span", undefined, decision === "accept" ? "Accept" : "Reject"));
    if (hotkeys[decision]) b.append(keyHint(hotkeys[decision]));
    b.onclick = async () => {
      buttons.forEach((x) => (x.disabled = true));
      b.classList.add("chosen");
      setStatus("Sending…");
      let r: { ok: boolean; error?: string };
      try { r = await window.inlook.decideReview(reviewId, decision); }
      catch (err) { r = { ok: false, error: (err as Error).message }; }
      if (r.ok) { setStatus("Sent"); return; } // the card turns into the outcome on review.closed
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

// --- the fact card -----------------------------------------------------------------------------------

const TITLES: Record<Phase, string> = { outdated: "Outdated", review: "Needs review", confirmed: "Up to date", updated: "Fact updated", kept: "Kept" };

function buildFact(c: HTMLElement, v: FactView, roll: boolean) {
  c.classList.add(v.phase);
  if (v.phase === "outdated" || v.phase === "review") c.dataset.tier = v.tier;
  titleRow(c, TITLES[v.phase], v.phase === "updated" || v.phase === "confirmed" ? "tick" : v.phase === "kept" ? undefined : "dot");
  c.append(el("p", "label", v.label), changeLine(v, roll));
  if (v.phase === "updated" || v.phase === "kept") {
    if (v.outcome) c.append(el("p", "meta", v.outcome));
    if (v.phase === "updated") c.append(extras(v));
    return;
  }
  const source = sourceLine(v);
  if (source) c.append(source);
  if (v.phase === "confirmed") return;
  c.append(extras(v));
  if (v.phase === "review" && v.reviewId) c.append(reviewActions(v.reviewId));
}

const showFact = (v: FactView, roll = false) => upsertCard(v.key, (c) => buildFact(c, v, roll));

/** A strategy or a person arrived for a card that is already showing: add the line without replaying the card. */
function patchExtras(v: FactView) {
  const card = cardAt(v.key);
  if (!card) return;
  flip(() => {
    const fresh = extras(v), old = card.querySelector(".extras"), actions = card.querySelector(".actions");
    if (old) old.replaceWith(fresh);
    else if (actions) actions.before(fresh);
    else card.append(fresh);
    fresh.querySelectorAll<HTMLElement>(".row").forEach((r) => r.classList.add("rise"));
    fit();
  });
}

/** The view of a fact whose card is on screen and can still take the strategies and people that follow. */
const openView = (factId: string) => {
  const v = facts.get(factId);
  return v && cardAt(v.key) && (v.phase === "outdated" || v.phase === "review") ? v : undefined;
};

function unverified(claimId: string, reason: string) {
  const claim = claims.get(claimId);
  claims.delete(claimId);
  // Something said in passing that matches no fact is not worth a card; a check the user asked for is.
  if (claim?.source === "audio" && reason === "no_match") { dismiss(claimId, 300); return; }
  upsertCard(claimId, (c) => {
    c.classList.add("unverified");
    titleRow(c, reason === "no_match" ? "No matching fact" : "Could not be checked");
    if (claim?.text) c.append(el("p", "claim", claim.text));
  });
  later(claimId, 3800, () => dismiss(claimId, 700));
}

// --- checking: the steps of a running check ------------------------------------------------------------

const SOURCES: Record<string, string> = { audio: "Heard in the meeting", selection: "From your selection", screenshot: "Read from your screen", page: "Source page re-check" };

function stepItem(card: HTMLElement, step: string, text: string, state: "done" | "active") {
  const list = card.querySelector(".steps");
  if (!list) return;
  flip(() => {
    list.querySelectorAll(".active").forEach((n) => n.classList.replace("active", "done"));
    let li = list.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!li) { li = el("li", "rise"); li.dataset.step = step; list.append(li); }
    li.textContent = text;
    li.classList.remove("done", "active");
    li.classList.add(state);
    fit();
  });
}

/** Transcript line a claim came from: amber while it is being checked, settled once it has an answer. */
function markLine(lineId: string | null | undefined, state: "claim" | "claim done") {
  if (!lineId) return;
  const line = transcript.querySelector<HTMLElement>(`[data-line="${CSS.escape(lineId)}"]`);
  if (line) line.className = state;
}
const settleClaim = (claimId: string) => markLine(claims.get(claimId)?.lineId, "claim done");

// --- events ----------------------------------------------------------------------------------------

function render(e: InlookEvent) {
  switch (e.type) {
    case "transcript.line": {
      if (isFiller(e.payload.text)) break;
      const line = el("p");
      line.dataset.line = e.payload.lineId;
      line.append(el("b", undefined, e.payload.speaker), el("span", undefined, e.payload.text));
      lastLineAt = Date.now();
      clearTimeout(transcriptTimer);
      transcriptTimer = window.setTimeout(() => flip(() => {}), TRANSCRIPT_IDLE_MS + 50);
      flip(() => {
        transcript.append(line);
        while (transcript.children.length > MAX_LINES) transcript.firstElementChild!.remove();
        fit(); // a taller transcript leaves the cards less room
      });
      break;
    }
    case "claim.spotted": {
      const { claimId, text, source, lineId } = e.payload;
      remember(claims, claimId, { text, source, lineId });
      markLine(lineId, "claim");
      upsertCard(claimId, (c) => {
        c.classList.add("checking");
        titleRow(c, "Checking", "dot");
        c.append(el("p", "claim", text));
        const steps = el("ul", "steps");
        const heard = el("li", "done", SOURCES[source] ?? "Claim spotted");
        heard.dataset.step = "spotted";
        steps.append(heard);
        c.append(steps);
      });
      break;
    }
    case "claim.progress": {
      const card = cardAt(e.payload.claimId);
      if (!card?.classList.contains("checking")) break;
      if (e.payload.step === "matched")
        stepItem(card, "matched", e.payload.label ? `Found in memory: ${e.payload.label}` : "Found in memory", "done");
      else {
        const domain = domainOf(e.payload.sourceUrl);
        stepItem(card, "reading", domain ? `Reading ${domain}…` : "Searching the web…", "active");
      }
      break;
    }
    case "claim.unverified":
      settleClaim(e.payload.claimId);
      unverified(e.payload.claimId, e.payload.reason);
      break;
    case "claim.verdict": {
      const p = e.payload;
      settleClaim(p.claimId);
      if (p.verdict === "unverifiable") { unverified(p.claimId, "unverifiable"); break; }
      claims.delete(p.claimId);
      // The fact already has a card (a review waiting, or the same answer moments ago): point at that one
      // instead of showing the same headline twice.
      const shown = facts.get(p.factId);
      const existing = shown && shown.key !== p.claimId ? cardAt(shown.key) : null;
      if (shown && existing && shown.phase !== "updated" && shown.phase !== "kept") {
        dismiss(p.claimId, 300);
        existing.classList.remove("land");
        void existing.offsetWidth; // restart the ring pulse
        existing.classList.add("land");
        break;
      }
      const v: FactView = {
        factId: p.factId, key: p.claimId, phase: p.verdict === "current" ? "confirmed" : "outdated", tier: p.card.criticality,
        label: factLabel(p.card.fact, p.oldValue), old: p.oldValue, new: p.newValue ?? p.oldValue,
        sourceUrl: p.sourceUrl, evidence: p.evidence, checkedAt: e.at, reviewers: [], notified: [], strategies: new Map(),
      };
      remember(facts, p.factId, v);
      showFact(v, v.phase === "outdated");
      if (v.phase === "confirmed") later(v.key, CONFIRMED_MS, () => dismiss(v.key, OUTCOME_FADE_MS));
      break;
    }
    case "review.created": {
      const p = e.payload, shown = facts.get(p.factId);
      // The fact's verdict card becomes the review, unless it is another review still waiting for its decision.
      const reuse = shown && cardAt(shown.key) && shown.phase !== "review";
      const v: FactView = {
        ...(reuse ? shown : { factId: p.factId, key: `review:${p.reviewId}`, notified: [], strategies: new Map() }),
        phase: "review", tier: p.tier, label: splitChange(p.card.fact)?.label ?? shown?.label ?? factLabel(p.card.fact, p.oldValue),
        old: p.oldValue, new: p.newValue, evidence: p.evidence || shown?.evidence, reviewId: p.reviewId, reviewers: p.reviewers,
        checkedAt: shown?.checkedAt ?? e.at, sourceUrl: shown?.sourceUrl,
      };
      remember(facts, p.factId, v);
      showFact(v);
      break;
    }
    case "review.closed": {
      // The review card itself shows the outcome, then fades: Accept turns it into the update (the fact.updated
      // right behind adds nothing), Reject into "Kept" with the stored value.
      const v = facts.get(e.payload.factId);
      if (!v || v.reviewId !== e.payload.reviewId || !cardAt(v.key)) break;
      const accepted = e.payload.status === "accepted";
      v.phase = accepted ? "updated" : "kept";
      v.outcome = accepted ? "Accepted · saved as the current value" : "Rejected · the stored value stays";
      showFact(v);
      later(v.key, accepted ? UPDATED_MS : KEPT_MS, () => dismiss(v.key, OUTCOME_FADE_MS));
      break;
    }
    case "fact.updated": {
      const p = e.payload, shown = facts.get(p.factId);
      if (shown?.phase === "updated" && cardAt(shown.key)) break; // already showing this update (Accept)
      // An automatic update (low tier, no review): the fact's verdict card turns into it. A review still
      // waiting keeps its card; the update then gets one of its own.
      const reuse = shown && cardAt(shown.key) && shown.phase !== "review";
      const parts = splitChange(p.card.fact);
      const v: FactView = {
        factId: p.factId, key: reuse ? shown.key : `fact:${p.factId}`, phase: "updated", tier: p.card.criticality,
        label: parts?.label ?? shown?.label ?? p.card.fact, old: parts?.old ?? shown?.old ?? "", new: p.version.value,
        reviewers: [], notified: [], strategies: new Map(),
        outcome: domainOf(p.version.source) ? `Updated from ${domainOf(p.version.source)}` : "Updated automatically",
      };
      if (reuse || !shown) remember(facts, p.factId, v);
      showFact(v);
      later(v.key, AUTO_UPDATED_MS, () => dismiss(v.key, OUTCOME_FADE_MS));
      break;
    }
    case "strategy.flagged": {
      const p = e.payload, v = openView(p.factId);
      remember(strategyFact, p.strategyId, p.factId);
      if (v) { v.strategies.set(p.strategyId, { name: p.name, healthy: false }); patchExtras(v); break; }
      upsertCard(`strategy:${p.strategyId}`, (c) => {
        c.dataset.tier = "high";
        titleRow(c, "Strategy flagged", "dot");
        c.append(el("p", "claim", p.name));
      });
      break;
    }
    case "strategy.healthy": {
      const p = e.payload, v = facts.get(strategyFact.get(p.strategyId) ?? "");
      dismiss(`strategy:${p.strategyId}`, OUTCOME_FADE_MS);
      const s = v?.strategies.get(p.strategyId);
      if (!v || !s) break;
      if (v.phase === "updated") s.healthy = true; // "… is healthy again" on the card that fixed it
      else v.strategies.delete(p.strategyId);
      patchExtras(v);
      break;
    }
    case "message.created": {
      const p = e.payload, v = openView(p.factId);
      if (v) {
        for (const who of p.to) if (!v.notified.some((n) => n.id === who.id)) v.notified.push(who);
        patchExtras(v);
        break;
      }
      upsertCard(`message:${p.messageId}`, (c) => {
        c.classList.add("message");
        titleRow(c, "Inlook");
        c.append(el("p", "claim", p.text), row("To", ...p.to.map((who) => person(who, true))));
      });
      break;
    }
  }
}

// --- wiring ----------------------------------------------------------------------------------------

window.inlook.onEvent(render);

/** The accept / reject hotkey decides the newest review that is still waiting (the topmost one). */
window.inlook.onDecide((decision: ReviewRequest["decision"]) => {
  const button = cards.querySelector<HTMLButtonElement>(`.card.review button[data-decision="${decision}"]:not(:disabled)`);
  button?.click();
});

window.inlook.onLevel((level) => { meter.style.setProperty("--level", level.toFixed(2)); });

const applyState = (s: OverlayState) => {
  overlay = { stream: s.stream, transcribing: s.transcribing, audio: s.audio };
  if (JSON.stringify(hotkeys) !== JSON.stringify(s.hotkeys)) {
    hotkeys = s.hotkeys;
    cards.querySelectorAll<HTMLButtonElement>(".actions button").forEach((b) => {
      b.querySelector("kbd")?.remove();
      const key = hotkeys[b.dataset.decision as "accept" | "reject"];
      if (key) b.append(keyHint(key));
    });
  }
  if (!s.transcribing) meter.style.setProperty("--level", "0");
  flip(() => {});
};
window.inlook.onState(applyState);
void window.inlook.getState().then(applyState);
