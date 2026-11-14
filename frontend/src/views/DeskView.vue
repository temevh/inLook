<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import ClaimCard from "../components/ClaimCard.vue";
import Pill from "../components/Pill.vue";
import ReviewCard from "../components/ReviewCard.vue";
import ScopeTree from "../components/ScopeTree.vue";
import StrategyCard from "../components/StrategyCard.vue";
import { personName } from "../lib/format";
import { TIER } from "../lib/labels";
import { useInlook } from "../stores/inlook";

const store = useInlook();
const route = useRoute();
const me = computed(() => store.viewer);
const scope = computed(() => store.scope);

const greeting = computed(() => {
  const h = new Date().getHours();
  return `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${me.value?.name.split(" ")[0] ?? ""}`;
});

const pending = computed(() => scope.value.reviews.filter((r) => r.status === "pending"));
const mine = computed(() => pending.value.filter((r) => r.reviewers.includes(me.value?.id ?? "")));
const others = computed(() => pending.value.filter((r) => !r.reviewers.includes(me.value?.id ?? "")));
const flagged = computed(() => scope.value.strategies.filter((s) => s.status === "flagged").length);
const strategies = computed(() =>
  [...scope.value.strategies].sort(
    (a, b) => Number(b.status === "flagged") - Number(a.status === "flagged") ||
      Number(b.owners.includes(me.value?.id ?? "")) - Number(a.owners.includes(me.value?.id ?? "")) || a.name.localeCompare(b.name),
  ),
);

// Meeting summary: this meeting's claims that touch the viewer's scope.
const RECENT_MS = 12 * 60 * 60 * 1000;
const recent = computed(() => store.claims.filter((c) => Date.now() - Date.parse(c.at) < RECENT_MS));
const recentInScope = computed(() => recent.value.filter((c) => c.factId && scope.value.facts.has(c.factId)));
const meetingLabel = computed(() =>
  store.playing ? "In progress" : store.meetingDone ? "Over" : store.meetingIndex ? "Paused" : recent.value.length ? "Today" : "Not started");
</script>

<template>
  <div v-if="store.loading" class="loading" aria-busy="true">
    <div v-for="i in 4" :key="i" class="card skel-card"><div class="skel w40" /><div class="skel w80 tall" /><div class="skel w60" /></div>
  </div>

  <div v-else-if="!store.viewer" class="card nodata">
    <h1>No company data yet</h1>
    <p class="muted">The dashboard could not load people, facts or strategies. Start the data API with <code>npm run api</code>, or switch to Demo in the top bar.</p>
  </div>

  <div v-else class="desk">
    <h1>{{ greeting }}</h1>

    <section class="kpis" aria-label="Key numbers">
      <div class="card kpi" :class="{ warn: mine.length }"><p class="label">Waiting on you</p><p class="num big">{{ mine.length }}</p><p class="muted small">reviews you can decide</p></div>
      <div class="card kpi" :class="{ bad: flagged }"><p class="label">Strategies at risk</p><p class="num big">{{ flagged }} / {{ scope.strategies.length }}</p><p class="muted small">{{ scope.strategies.length ? "owned by you or your team" : "no strategy in your scope" }}</p></div>
      <div class="card kpi"><p class="label">Facts in your scope</p><p class="num big">{{ scope.facts.size }}</p><p class="muted small">of {{ Object.keys(store.records.facts).length }} in company memory</p></div>
      <div class="card kpi"><p class="label">Unread notifications</p><p class="num big">{{ store.unread }}</p><p class="muted small">in the bell at the top</p></div>
    </section>

    <div class="layout">
      <div class="main">
        <section class="card panel" aria-labelledby="dec-h">
          <div class="panel-head"><h2 id="dec-h">Needs your decision</h2><span v-if="pending.length" class="muted small">{{ mine.length }} yours · {{ others.length }} waiting on others</span></div>
          <p v-if="!mine.length" class="empty">{{ others.length ? "Nothing waiting on you." : "Nothing waiting for you. When a fact you are responsible for changes, the decision lands here." }}</p>
          <TransitionGroup name="list" tag="div" class="reviews">
            <ReviewCard v-for="r in mine" :key="r.id" :review="r" :highlight="route.hash === `#review-${r.id}`" />
          </TransitionGroup>
          <div v-if="others.length" class="others">
            <p class="label">Waiting on others in your scope</p>
            <ul>
              <li v-for="r in others" :key="r.id">
                <Pill :tone="TIER[r.tier].tone">{{ TIER[r.tier].label }}</Pill>
                <RouterLink :to="`/facts/${r.factId}`" class="fact">{{ store.records.facts[r.factId]?.label ?? r.factId }}</RouterLink>
                <span class="muted small change">{{ r.oldValue }} → {{ r.newValue }}</span>
                <span class="muted small who">waiting on {{ r.reviewers.map((id) => personName(id, store.records)).join(", ") }}</span>
              </li>
            </ul>
          </div>
        </section>

        <section class="card panel" aria-labelledby="str-h">
          <div class="panel-head"><h2 id="str-h">Your strategies</h2><RouterLink to="/strategies" class="small">Open Strategies</RouterLink></div>
          <p v-if="!strategies.length" class="empty">You and your team own no strategy, so inLook won't message you about strategy risk. You still hear about facts you stated.</p>
          <div class="strategies"><StrategyCard v-for="s in strategies" :key="s.id" :strategy="s" /></div>
        </section>
      </div>

      <aside class="side">
        <section class="card panel" aria-labelledby="mt-h">
          <div class="panel-head"><h2 id="mt-h">Meeting</h2><span class="muted small">{{ meetingLabel }}</span></div>
          <p class="small muted">{{ recent.length }} claim{{ recent.length === 1 ? "" : "s" }} checked{{ recent.length ? `, ${recentInScope.length} in your scope` : "" }}.</p>
          <div v-if="recentInScope.length" class="stack">
            <ClaimCard v-for="c in recentInScope.slice(0, 3)" :key="c.id" :claim="c" :in-scope="false" />
          </div>
          <RouterLink to="/meetings" class="btn more">Open Meetings</RouterLink>
        </section>
        <ScopeTree />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.nodata { padding: 32px; display: flex; flex-direction: column; gap: 8px; max-width: 640px; }
.desk { display: flex; flex-direction: column; gap: 20px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.kpi { padding: 16px 18px; }
.kpi.warn { border-color: var(--warning); }
.kpi.bad { border-color: var(--danger); }
.big { font-size: 2.5rem; margin-top: 4px; line-height: 1.1; }
.layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.main, .side { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.reviews { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
.reviews > * { scroll-margin-top: 140px; }
.strategies { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.more { align-self: flex-start; text-decoration: none; display: inline-flex; align-items: center; }
.others { border-top: 1px solid var(--rule); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.others ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.others li { display: grid; grid-template-columns: auto minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 10px; font-size: 0.875rem; padding: 6px 0; }
.others .fact { color: var(--fg); font-weight: 600; }
@media (max-width: 700px) { .others li { grid-template-columns: auto minmax(0, 1fr); } .others .change, .others .who { grid-column: 2; } }
.panel { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.empty { padding: 20px 8px; text-align: center; color: var(--muted); font-size: 0.875rem; line-height: 1.5; }
.empty.left { text-align: left; padding: 4px 0; }
.loading { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.skel-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.skel { height: 12px; border-radius: 6px; background: #1f2330; }
.skel.tall { height: 20px; } .w40 { width: 40%; } .w60 { width: 60%; } .w80 { width: 80%; }
@media (max-width: 1100px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .kpis { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .kpis, .loading, .reviews, .strategies { grid-template-columns: minmax(0, 1fr); }
}
</style>
