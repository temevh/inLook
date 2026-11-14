<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import FactRipple from "../components/FactRipple.vue";
import Pill from "../components/Pill.vue";
import { day, domain, personName } from "../lib/format";
import { factStatus, TIER } from "../lib/labels";
import { ifChanged } from "../lib/routing";
import { effectiveTier } from "../lib/scope";
import { useInlook } from "../stores/inlook";

const store = useInlook();
const route = useRoute();
const router = useRouter();

const me = computed(() => store.viewer?.id ?? "");
const facts = computed(() =>
  Object.values(store.records.facts)
    .filter((f) => store.scope.facts.has(f.id))
    .sort((a, b) => Number(b.statedBy === me.value) - Number(a.statedBy === me.value) || Number(store.scope.ownFacts.has(b.id)) - Number(store.scope.ownFacts.has(a.id)) || a.label.localeCompare(b.label)),
);
const hidden = computed(() => Object.keys(store.records.facts).length - facts.value.length);
const tierOf = (id: string) => {
  const f = store.records.facts[id];
  return TIER[effectiveTier(id, f.tier, store.records.strategies)];
};

/** Why a fact is in the viewer's scope: who stated it, or whose strategy relies on it. */
function relation(id: string): { label: string; tone: "low" | "quiet"; hint: string } {
  const f = store.records.facts[id];
  if (f.statedBy === me.value) return { label: "Stated by you", tone: "low", hint: "You stated this fact." };
  if (store.scope.team.has(f.statedBy)) return { label: "Your team", tone: "quiet", hint: "Someone below you stated this fact." };
  const mine = Object.values(store.records.strategies).some((s) => s.factIds.includes(id) && s.owners.includes(me.value));
  return mine
    ? { label: "Your strategy uses it", tone: "low", hint: "Another team stated it, but a strategy you own relies on it." }
    : { label: "Team strategy uses it", tone: "quiet", hint: "Another team stated it, but a strategy your team owns relies on it." };
}
const raised = (id: string) => store.records.facts[id].tier !== effectiveTier(id, store.records.facts[id].tier, store.records.strategies);

const selected = computed(() => {
  const id = route.params.id as string | undefined;
  return (id && store.scope.facts.has(id) ? store.records.facts[id] : undefined) ?? facts.value[0];
});
const proposal = computed(() =>
  selected.value ? Object.values(store.records.reviews).find((r) => r.factId === selected.value!.id && r.status === "pending") : undefined,
);
const versions = computed(() => [...(selected.value?.versions ?? [])].reverse());
const relying = computed(() => Object.values(store.records.strategies).filter((s) => selected.value && s.factIds.includes(selected.value.id)));
const routing = computed(() => (selected.value ? ifChanged(selected.value, store.records) : []));
const busy = computed(() => !!(selected.value && store.busy[`f:${selected.value.id}`]));

function select(id: string) {
  void router.replace(`/facts/${id}`);
}
</script>

<template>
  <div class="facts">
    <div class="left">
    <section class="card table-card" aria-labelledby="facts-h">
      <div class="head">
        <h1 id="facts-h">Company memory</h1>
        <span class="muted small">{{ hidden ? `your scope · ${hidden} fact${hidden > 1 ? "s" : ""} outside it hidden` : "everything in company memory" }}</span>
      </div>
      <p v-if="!facts.length" class="empty">No facts in your scope yet.</p>
      <div v-else class="scroll">
        <table>
          <thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">Tier</th><th scope="col">Status</th><th scope="col">Stated by</th></tr></thead>
          <tbody>
            <tr v-for="f in facts" :key="f.id" :class="{ sel: selected?.id === f.id }" @click="select(f.id)">
              <th scope="row">
                <button type="button" class="link" :aria-pressed="selected?.id === f.id" @click.stop="select(f.id)">{{ f.label }}</button>
                <Pill :tone="relation(f.id).tone" :title="relation(f.id).hint">{{ relation(f.id).label }}</Pill>
              </th>
              <td>{{ f.value }}</td>
              <td><Pill :tone="tierOf(f.id).tone" :title="raised(f.id) ? 'Stated as low, raised because a strategy relies on it' : undefined">{{ tierOf(f.id).label }}{{ raised(f.id) ? " ↑" : "" }}</Pill></td>
              <td><Pill :tone="factStatus(f).tone">{{ factStatus(f).label }}</Pill></td>
              <td class="muted">{{ personName(f.statedBy, store.records) }}{{ f.statedBy === me ? " (you)" : "" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="selected" class="scroll"><FactRipple :fact="selected" /></div>
    </div>

    <aside v-if="selected" class="card panel" aria-labelledby="fact-h">
      <div class="row"><span class="label">Fact</span><Pill :tone="tierOf(selected.id).tone">{{ tierOf(selected.id).label }}</Pill></div>
      <h2 id="fact-h" class="title">{{ selected.label }}</h2>
      <p class="muted small">
        Source: <a v-if="selected.sourceUrl" :href="selected.sourceUrl" target="_blank" rel="noopener">{{ domain(selected.sourceUrl) }}</a><span v-else>no source page</span>
        · stated by {{ personName(selected.statedBy, store.records) }}
      </p>
      <div>
        <button class="btn primary" type="button" :disabled="busy || !selected.sourceUrl" @click="store.recheck(selected.id)">
          <span v-if="busy" class="spinner" aria-hidden="true" />{{ busy ? "Checking source…" : "Re-check now" }}
        </button>
        <p v-if="!selected.sourceUrl" class="muted small hint">No source page to re-check.</p>
      </div>

      <p class="label">Version history</p>
      <div v-if="proposal" class="version proposed">
        <div class="vhead"><span class="label">Proposed</span><Pill tone="warn">In review</Pill></div>
        <div class="vbody"><p class="value">{{ proposal.newValue }}</p><p class="muted small">waiting on {{ proposal.reviewers.map((id) => personName(id, store.records)).join(", ") }}</p></div>
      </div>
      <div v-for="(v, i) in versions" :key="`${v.at}-${v.value}`" class="version" :class="{ old: i > 0 }">
        <div class="vhead"><span class="label">v{{ versions.length - i }}</span><Pill :tone="i === 0 ? 'ok' : 'quiet'">{{ i === 0 ? "current" : "superseded" }}</Pill></div>
        <div class="vbody"><p class="value">{{ v.value }}</p><p class="muted small">{{ personName(v.by, store.records) }} · {{ day(v.at) }}<span v-if="v.source"> · {{ domain(v.source) }}</span></p></div>
      </div>

      <p class="label">Strategies that rely on it</p>
      <p v-if="!relying.length" class="small muted">None.</p>
      <ul v-else class="rel">
        <li v-for="s in relying" :key="s.id">
          <RouterLink to="/strategies">{{ s.name }}</RouterLink> <Pill :tone="s.status === 'flagged' ? 'bad' : 'ok'">{{ s.status === "flagged" ? "Flagged" : "Healthy" }}</Pill>
          <span class="muted"> · {{ s.owners.map((id) => personName(id, store.records)).join(", ") }}</span>
        </li>
      </ul>

      <p class="label">If its source changes</p>
      <ol class="routing">
        <li v-for="(l, i) in routing" :key="i">{{ l }}</li>
      </ol>
    </aside>
  </div>
</template>

<style scoped>
.facts { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.left { flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.table-card { min-width: 0; }
.head { padding: 16px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.head h1 { font-size: 1.25rem; }
.scroll { overflow-x: auto; }
table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 0.875rem; }
th, td { text-align: left; padding: 12px 16px; border-top: 1px solid var(--rule); vertical-align: middle; }
thead th { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
tbody th { font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #191c27; }
tbody tr.sel { background: var(--tint-primary); }
.link { background: none; border: 0; padding: 4px 0; min-height: 32px; font-weight: 600; cursor: pointer; text-align: left; }
.empty { padding: 16px; color: var(--muted); }
.panel { flex: 1 1 360px; max-width: 440px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; align-items: center; gap: 8px; }
.title { font-size: 1.25rem; font-weight: 800; }
.hint { margin-top: 6px; }
.version { border: 1px solid var(--border); border-radius: 0.75rem; overflow: hidden; }
.version.old { opacity: 0.6; }
.version.proposed { border-color: var(--warning); }
.vhead { background: var(--raised); padding: 8px 14px; display: flex; align-items: center; justify-content: space-between; }
.vbody { padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
.value { font-size: 1.375rem; font-weight: 800; }
.rel { margin: 0; padding-left: 18px; font-size: 0.875rem; display: flex; flex-direction: column; gap: 6px; }
.rel a { color: var(--fg); }
.routing { margin: 0; padding-left: 18px; font-size: 0.8125rem; line-height: 1.5; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
</style>
