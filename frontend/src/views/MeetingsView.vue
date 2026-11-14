<script setup lang="ts">
import { computed, ref } from "vue";
import ClaimCard from "../components/ClaimCard.vue";
import { clock } from "../lib/format";
import type { ClaimState } from "../lib/fold";
import { CLAIM } from "../lib/labels";
import { MEETING } from "../mock/script";
import { useInlook } from "../stores/inlook";

const store = useInlook();

// Only this meeting's claims: older checks (weeks of history in the demo) are on the Activity page.
const RECENT_MS = 12 * 60 * 60 * 1000;
const recent = computed(() => store.claims.filter((c) => Date.now() - Date.parse(c.at) < RECENT_MS));

type Filter = "all" | "scope" | "misstated" | ClaimState;
const filter = ref<Filter>("all");
const counts = computed(() => {
  const c: Record<string, number> = { all: recent.value.length, scope: 0, misstated: 0 };
  for (const x of recent.value) {
    c[x.state] = (c[x.state] ?? 0) + 1;
    if (x.misstated) c.misstated++;
    if (x.factId && store.scope.facts.has(x.factId)) c.scope++;
  }
  return c;
});
const filters = computed(() => [
  { id: "all" as Filter, label: "All" },
  { id: "scope" as Filter, label: "In your scope" },
  { id: "misstated" as Filter, label: "Misstated" },
  ...(["outdated", "current", "unverifiable", "unverified", "checking"] as ClaimState[]).map((s) => ({ id: s as Filter, label: CLAIM[s].label.replace("…", "") })),
].filter((f) => f.id === "all" || counts.value[f.id]));
const claims = computed(() =>
  recent.value.filter((c) =>
    filter.value === "all" ? true
      : filter.value === "scope" ? !!c.factId && store.scope.facts.has(c.factId)
      : filter.value === "misstated" ? !!c.misstated
      : c.state === filter.value),
);

const transcript = computed(() => {
  const lines: { id: string; speaker: string; text: string; at: string }[] = [];
  for (const e of store.log) {
    if (e.type === "transcript.line" && Date.now() - Date.parse(e.at) < RECENT_MS) lines.push({ id: e.payload.lineId, speaker: e.payload.speaker, text: e.payload.text, at: e.at });
  }
  return lines.reverse();
});
/** Which transcript lines produced a claim, so the transcript can mark them. */
const claimedLines = computed(() => {
  const ids = new Set<string>();
  for (const e of store.log) if (e.type === "claim.spotted" && e.payload.lineId) ids.add(e.payload.lineId);
  return ids;
});

const status = computed(() => {
  if (store.playing) return { label: "Meeting in progress", cls: "live" };
  if (store.meetingDone) return { label: "Meeting over", cls: "done" };
  if (store.meetingIndex) return { label: "Paused", cls: "paused" };
  return { label: "No meeting running", cls: "idle" };
});
const playLabel = computed(() => (store.playing ? "Pause" : store.meetingDone ? "Meeting over" : store.meetingIndex ? "Resume meeting" : "Play meeting"));

const claimText = ref("");
function sendClaim() {
  void store.checkText(claimText.value);
  claimText.value = "";
}
</script>

<template>
  <div class="page">
    <div class="top">
      <div>
        <h1>Meetings</h1>
        <p class="muted small">What is said in the meeting, and how inLook checks every claim against company memory.</p>
      </div>
      <span class="status" :class="status.cls"><span class="dot" aria-hidden="true" />{{ status.label }}<template v-if="store.mode === 'demo' && store.meetingIndex"> · line {{ store.meetingIndex }} of {{ MEETING.length }}</template></span>
      <button class="btn primary" type="button" :disabled="store.meetingDone && !store.playing" @click="store.playMeeting()">{{ playLabel }}</button>
    </div>

    <section class="kpis" aria-label="This meeting">
      <div class="card kpi"><p class="label">Claims checked</p><p class="num big">{{ counts.all }}</p></div>
      <div class="card kpi" :class="{ bad: counts.outdated }"><p class="label">Outdated</p><p class="num big">{{ counts.outdated ?? 0 }}</p></div>
      <div class="card kpi"><p class="label">Still current</p><p class="num big">{{ counts.current ?? 0 }}</p></div>
      <div class="card kpi"><p class="label">Couldn't check</p><p class="num big">{{ (counts.unverifiable ?? 0) + (counts.unverified ?? 0) }}</p></div>
    </section>

    <div class="layout">
      <section class="card panel transcript" aria-labelledby="tr-h">
        <h2 id="tr-h">Transcript</h2>
        <p v-if="!transcript.length" class="muted small">Nothing said yet. {{ store.mode === "demo" ? "Press Play meeting to replay the demo meeting." : "Lines appear here when the overlay sends them." }}</p>
        <TransitionGroup name="list" tag="ol" class="lines">
          <li v-for="l in transcript" :key="l.id" :class="{ claimed: claimedLines.has(l.id) }">
            <div class="who"><span class="speaker">{{ l.speaker }}</span><span class="muted small">{{ clock(l.at) }}</span><span v-if="claimedLines.has(l.id)" class="tag">claim</span></div>
            <p class="small">{{ l.text }}</p>
          </li>
        </TransitionGroup>
      </section>

      <section class="card panel" aria-labelledby="cl-h">
        <div class="panel-head">
          <h2 id="cl-h">Claims</h2>
          <span class="muted small">newest first</span>
        </div>
        <form class="check" @submit.prevent="sendClaim">
          <label for="claim" class="visually-hidden">Check a claim</label>
          <input id="claim" v-model="claimText" placeholder="Check a claim, e.g. “Notion Plus costs $8 per seat”" />
          <button class="btn" type="submit" :disabled="!claimText.trim()">Check</button>
        </form>
        <div v-if="recent.length" class="filters" role="group" aria-label="Filter claims">
          <button v-for="f in filters" :key="f.id" type="button" class="chip" :aria-pressed="filter === f.id" @click="filter = f.id">
            {{ f.label }} <span class="muted">{{ counts[f.id] ?? 0 }}</span>
          </button>
        </div>
        <p v-if="!claims.length" class="empty">{{ recent.length ? "No claims match this filter." : "Listening. Claims appear here as inLook checks them. Earlier checks are on the Activity page." }}</p>
        <TransitionGroup name="list" tag="div" class="claims">
          <ClaimCard v-for="c in claims" :key="c.id" :claim="c" :in-scope="!!c.factId && store.scope.facts.has(c.factId)" />
        </TransitionGroup>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 20px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
.top > div { margin-right: auto; }
.top h1 { font-size: 1.5rem; }
.status { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 12px; font-size: 0.75rem; font-weight: 600; color: #fff; background: var(--quiet); }
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
.status.live { background: var(--brand); } .status.live .dot { animation: pulse 1.4s var(--ease) infinite; }
.status.paused { background: var(--warning); } .status.done { background: var(--success); }
@keyframes pulse { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .status.live .dot { animation: none; } }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.kpi { padding: 14px 18px; }
.kpi.bad { border-color: var(--danger); }
.big { font-size: 2.25rem; margin-top: 4px; line-height: 1.1; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 20px; align-items: start; }
.panel { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.panel-head { display: flex; align-items: baseline; gap: 10px; }
.transcript { position: sticky; top: 136px; max-height: calc(100vh - 156px); overflow-y: auto; }
.lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.lines li { line-height: 1.4; padding-left: 10px; border-left: 2px solid transparent; }
.lines li.claimed { border-left-color: var(--primary); }
.who { display: flex; align-items: baseline; gap: 8px; }
.speaker { font-weight: 600; font-size: 0.8125rem; }
.tag { font-size: 0.6875rem; font-weight: 600; color: var(--accent); }
.check { display: flex; gap: 8px; }
.check input { flex: 1; min-height: 44px; background: var(--sunken); border: 1px solid var(--border); border-radius: var(--r-btn); color: var(--fg); padding: 0 14px; font: inherit; font-size: 0.875rem; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--fg); font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--navy-900); border-color: var(--navy); }
.claims { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.empty { padding: 20px 4px; color: var(--muted); font-size: 0.875rem; }
@media (max-width: 1000px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .transcript { position: static; max-height: 360px; }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* Phones: the claim box fits the card, smaller numbers, play button full width. */
@media (max-width: 640px) {
  .page { gap: 16px; }
  .top > div { flex-basis: 100%; }
  .top .btn { flex: 1; }
  .kpis { gap: 10px; }
  .kpi { padding: 12px 14px; }
  .big { font-size: 1.875rem; }
  .panel { padding: 14px; }
  .check input { min-width: 0; }
  .claims { grid-template-columns: minmax(0, 1fr); }
}
</style>
