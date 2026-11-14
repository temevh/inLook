// The one store. Live mode: load a snapshot from /api, then fold every newer /stream event into it.
// Demo mode: start from the seed and fold events that src/data/demo.ts produces in the browser.
import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import * as api from "../data/api";
import * as demo from "../data/demo";
import { openStream } from "../data/stream";
import { applyEvent, claimsFrom } from "../lib/fold";
import { buildInbox } from "../lib/inbox";
import { orgTree, scoped } from "../lib/scope";
import { MEETING } from "../mock/script";
import { demoSnapshot } from "../mock/seed";
import type { Connection, DataMode, InlookEvent, Records, Snapshot } from "../types";

type Tone = "ok" | "error" | "info";
const DEFAULT_USER = "p-ada";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The signed-in employee. There is no login yet, so it comes from `?user=<person id>` in the URL,
 * then VITE_INLOOK_USER in .env, then a default.
 */
function signedInUser(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get("user");
    if (fromUrl) return fromUrl;
  } catch { /* not in a browser */ }
  return import.meta.env.VITE_INLOOK_USER || DEFAULT_USER;
}

function initialMode(): DataMode {
  if (import.meta.env.MODE === "demo") return "demo";
  try { return new URLSearchParams(location.search).has("demo") ? "demo" : "live"; } catch { return "live"; }
}

export const useInlook = defineStore("inlook", () => {
  const mode = ref<DataMode>(initialMode());
  const connection = ref<Connection>("connecting");
  const loading = ref(true);
  /** Set when /api failed: the database or the data API is down. The stream may still work. */
  const apiError = ref<string | null>(null);
  const records = reactive<Records>({ people: {}, facts: {}, strategies: {}, reviews: {}, messages: {} });
  /** Every event seen, oldest first. */
  const log = ref<InlookEvent[]>([]);
  const viewerId = ref(signedInUser());
  const busy = reactive<Record<string, boolean>>({});
  const toast = ref<{ text: string; tone: Tone } | null>(null);
  const playing = ref(false);
  const meetingIndex = ref(0);

  let seen = new Set<number>();
  let snapshotSeq = 0;
  let bootId: string | null = null;
  let buffer: InlookEvent[] | null = null;
  let closeStream: (() => void) | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped on every (re)start, so demo steps still waiting from before a reset are dropped. */
  let demoRun = 0;
  /** Bumped by every Play/Resume, so a paused loop that wakes up after a resume steps aside. */
  let meetingLoop = 0;

  // ---------- derived ----------
  const viewer = computed(() => records.people[viewerId.value] ?? Object.values(records.people)[0]);
  const scope = computed(() => scoped(viewer.value?.id ?? "", records));
  const org = computed(() => orgTree(records.people));
  const claims = computed(() => claimsFrom(log.value));
  const lastSeq = computed(() => log.value.at(-1)?.seq ?? 0);
  const meetingDone = computed(() => meetingIndex.value >= MEETING.length);

  // ---------- notifications ----------
  // Hidden items and the last time the bell was opened are per person and per browser (localStorage).
  // Losing them only brings hidden notifications back, so storage failures are ignored.
  const store = (key: string) => `inlook.${key}.${viewerId.value}`;
  function readStored<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(store(key)); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  }
  function writeStored(key: string, value: unknown) {
    try { localStorage.setItem(store(key), JSON.stringify(value)); } catch { /* private window */ }
  }
  const hidden = ref<string[]>(readStored("hidden", []));
  const seenAt = ref<string>(readStored("seenAt", ""));
  // Each person has their own hidden items and read state: reload them when the signed-in person changes.
  watch(viewerId, () => { hidden.value = readStored("hidden", []); seenAt.value = readStored("seenAt", ""); });
  const allInbox = computed(() => (viewer.value ? buildInbox(viewer.value.id, scope.value, records, log.value) : []));
  const inbox = computed(() => allInbox.value.filter((i) => !hidden.value.includes(i.key)));
  const hiddenCount = computed(() => allInbox.value.length - inbox.value.length);
  const unread = computed(() => inbox.value.filter((i) => i.at > seenAt.value).length);
  function hide(key: string) { hidden.value = [...hidden.value, key]; writeStored("hidden", hidden.value); }
  function hideAll() { hidden.value = [...new Set([...hidden.value, ...inbox.value.map((i) => i.key)])]; writeStored("hidden", hidden.value); }
  function unhideAll() { hidden.value = []; writeStored("hidden", []); }
  function markRead() {
    const newest = inbox.value[0]?.at ?? "";
    if (newest > seenAt.value) { seenAt.value = newest; writeStored("seenAt", newest); }
  }

  // ---------- helpers ----------
  function say(text: string, tone: Tone = "ok") {
    toast.value = { text, tone };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = null), 5000);
  }

  function useSnapshot(s: Snapshot) {
    records.people = s.people;
    records.facts = s.facts;
    records.strategies = s.strategies;
    records.reviews = s.reviews;
    records.messages = s.messages;
    log.value = [...s.events].sort((a, b) => a.seq - b.seq);
    seen = new Set(log.value.map((e) => e.seq));
    // Events up to this seq are already reflected in the records; a replay of them only fills the log.
    snapshotSeq = log.value.at(-1)?.seq ?? 0;
    if (!records.people[viewerId.value]) viewerId.value = DEFAULT_USER;
  }

  function receive(e: InlookEvent) {
    if (buffer) { buffer.push(e); return; }
    if (seen.has(e.seq)) return;
    seen.add(e.seq);
    if (log.value.length && e.seq < log.value[log.value.length - 1].seq) {
      log.value = [...log.value, e].sort((a, b) => a.seq - b.seq);
    } else {
      log.value.push(e);
    }
    if (e.seq > snapshotSeq) applyEvent(records, e);
    settle(e);
  }

  /** Clears a button's spinner when the event that confirms its action arrives. */
  function settle(e: InlookEvent) {
    if (e.type === "review.closed" && busy[e.payload.reviewId]) {
      delete busy[e.payload.reviewId];
      const f = records.facts[e.payload.factId];
      const rev = records.reviews[e.payload.reviewId];
      say(e.payload.status === "accepted"
        ? `${f?.label ?? "Fact"} is now ${rev?.newValue ?? "updated"}. Everyone who relies on it has been told.`
        : `Kept ${rev?.oldValue ?? "the old value"} for ${f?.label ?? "this fact"}.`);
    }
    if (e.type === "claim.verdict" && busy[`f:${e.payload.factId}`]) {
      delete busy[`f:${e.payload.factId}`];
      const label = records.facts[e.payload.factId]?.label ?? "Fact";
      say(e.payload.verdict === "current" ? `${label} still matches its source.`
        : e.payload.verdict === "outdated" ? `${label} has changed at its source: ${e.payload.newValue}.` : `${label} could not be verified right now.`,
        e.payload.verdict === "unverifiable" ? "info" : "ok");
    }
  }

  const emitDemo: demo.Emit = (type, payload) => {
    receive({ seq: lastSeq.value + 1, type, payload, at: new Date().toISOString() } as InlookEvent);
  };

  /** Plays the demo engine's steps with their delays. Stops if the demo was reset meanwhile. */
  async function runSteps(steps: demo.Step[]) {
    const run = demoRun;
    for (const s of steps) {
      await sleep(s.delayMs);
      if (run !== demoRun || mode.value !== "demo") return;
      (emitDemo as (t: string, p: unknown) => void)(s.type, s.payload);
    }
  }

  // ---------- lifecycle ----------
  async function reloadSnapshot() {
    buffer = [];
    try {
      useSnapshot(await api.loadSnapshot());
      apiError.value = null;
    } catch (err) {
      apiError.value = err instanceof Error ? err.message : String(err);
    }
    const held = buffer;
    buffer = null;
    held.forEach(receive);
  }

  async function startLive() {
    loading.value = true;
    await reloadSnapshot();
    loading.value = false;
    closeStream = openStream({
      onConnection: (c) => (connection.value = c),
      onEvent: (e, b) => {
        if (b && bootId && b !== bootId) {
          // The backend restarted: its seq may start again from 1, so start over from a fresh snapshot.
          bootId = b;
          seen = new Set();
          void reloadSnapshot().then(() => receive(e));
          return;
        }
        bootId ??= b;
        receive(e);
      },
    });
  }

  function startDemo() {
    useSnapshot(demoSnapshot());
    apiError.value = null;
    connection.value = "live";
    loading.value = false;
  }

  function stop() {
    demoRun++;
    closeStream?.();
    closeStream = null;
    playing.value = false;
    bootId = null;
  }

  async function start() {
    stop();
    meetingIndex.value = 0;
    if (mode.value === "demo") startDemo();
    else await startLive();
  }

  function setMode(m: DataMode) {
    mode.value = m;
    void start();
  }

  // ---------- actions ----------
  async function decide(reviewId: string, decision: "accept" | "reject") {
    const rev = records.reviews[reviewId];
    if (!rev || busy[reviewId]) return;
    busy[reviewId] = true;
    if (mode.value === "demo") {
      await sleep(700);
      rev.closedBy = viewerId.value;
      await runSteps(demo.decide(records, rev, decision, new Date().toISOString(), viewerId.value));
      return;
    }
    try {
      await api.decideReview(reviewId, decision);
      // The spinner stays until review.closed arrives on the stream.
      setTimeout(() => { if (busy[reviewId]) { delete busy[reviewId]; say("Saved, but the confirmation has not arrived yet.", "info"); } }, 15000);
    } catch (err) {
      delete busy[reviewId];
      say(err instanceof api.HttpError && err.status === 409 ? "Someone already closed this review." : `Could not save: ${(err as Error).message}`, "error");
    }
  }

  async function recheck(factId: string) {
    const key = `f:${factId}`;
    if (busy[key]) return;
    busy[key] = true;
    if (mode.value === "demo") {
      const fact = records.facts[factId];
      await runSteps(demo.routeClaim(records, { text: `Re-check: ${fact?.label ?? factId}`, source: "page", factId }, new Date().toISOString()));
      return;
    }
    try {
      await api.recheckFact(factId);
      setTimeout(() => { if (busy[key]) { delete busy[key]; say("The re-check is taking longer than usual.", "info"); } }, 30000);
    } catch (err) {
      delete busy[key];
      say(`Could not start the re-check: ${(err as Error).message}`, "error");
    }
  }

  async function checkText(text: string) {
    const t = text.trim();
    if (!t) return;
    if (mode.value === "demo") {
      await runSteps(demo.routeClaim(records, { text: t, source: "selection", factId: demo.matchFact(t, records) }, new Date().toISOString()));
      return;
    }
    try {
      await api.checkClaim(t);
      say("Sent. The result appears under Live from the meeting.", "info");
    } catch (err) {
      say(`Could not send the claim: ${(err as Error).message}`, "error");
    }
  }

  /**
   * Demo mode replays the meeting in demo-data.json line by line; each claim goes through the demo engine.
   * Live mode sends the same meeting's claims to POST /check, so the real pipeline handles them.
   */
  async function playMeeting() {
    if (playing.value) { playing.value = false; return; }
    playing.value = true;
    const run = demoRun;
    const loop = ++meetingLoop;
    while (playing.value && run === demoRun && loop === meetingLoop && meetingIndex.value < MEETING.length) {
      const item = MEETING[meetingIndex.value];
      if (mode.value === "live" && !item.claim) { meetingIndex.value++; continue; }
      await sleep(mode.value === "live" ? 4000 : item.delayMs);
      if (!playing.value || run !== demoRun || loop !== meetingLoop) break;
      if (mode.value === "demo") {
        const lineId = `line-${meetingIndex.value + 1}`;
        emitDemo("transcript.line", { lineId, speaker: item.speaker, text: item.line });
        meetingIndex.value++;
        if (item.claim) {
          await sleep(700);
          await runSteps(demo.routeClaim(records, { ...item.claim, source: item.claim.source ?? "audio", lineId }, new Date().toISOString()));
          if (item.claim.autoDecide && item.claim.factId) scheduleAutoDecide(item.claim.factId, item.claim.autoDecide);
        }
      } else {
        try { await api.checkClaim(item.claim!.text); }
        catch (err) { say(`Could not send the claim: ${(err as Error).message}`, "error"); playing.value = false; break; }
        meetingIndex.value++;
      }
    }
    if (run === demoRun && loop === meetingLoop) playing.value = false;
  }

  /**
   * Demo only: someone else decides a review on their own after a while, so the signed-in person sees
   * a review closed by a colleague. Skipped when that colleague is the one signed in: then it is theirs to do.
   */
  function scheduleAutoDecide(factId: string, a: { by: string; decision: "accept" | "reject"; afterMs: number }) {
    const run = demoRun;
    setTimeout(() => {
      if (run !== demoRun || mode.value !== "demo" || viewerId.value === a.by) return;
      const rev = Object.values(records.reviews).find((x) => x.factId === factId && x.status === "pending" && x.reviewers.includes(a.by));
      if (!rev || busy[rev.id]) return;
      rev.closedBy = a.by;
      void runSteps(demo.decide(records, rev, a.decision, new Date().toISOString(), a.by));
    }, a.afterMs);
  }

  /** Demo only: sign in as someone else, keeping everything that has happened so far. */
  function setViewer(id: string) {
    if (mode.value !== "demo" || !records.people[id]) return;
    viewerId.value = id;
    try {
      const url = new URL(location.href);
      url.searchParams.set("user", id);
      history.replaceState(history.state, "", url);
    } catch { /* not in a browser */ }
  }

  function resetDemo() {
    if (mode.value === "demo") void start();
  }

  return {
    mode, connection, loading, apiError, records, log, viewerId, viewer, scope, org, claims, lastSeq,
    busy, toast, playing, meetingIndex, meetingDone,
    inbox, hiddenCount, unread, seenAt, hide, hideAll, unhideAll, markRead,
    start, stop, setMode, setViewer, decide, recheck, checkText, playMeeting, resetDemo, receive, useSnapshot,
  };
});
