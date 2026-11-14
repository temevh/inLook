<script setup lang="ts">
import { computed, ref } from "vue";
import Pill from "../components/Pill.vue";
import { clock, eventFact, summarize } from "../lib/format";
import { EVENT_TONE } from "../lib/labels";
import { useInlook } from "../stores/inlook";

const store = useInlook();
const filter = ref("all");
const groups: Record<string, string> = { all: "All types", claim: "Claims", review: "Reviews", fact: "Fact updates", strategy: "Strategies", message: "Messages" };

const shown = computed(() => {
  const claimFacts = new Map(store.claims.filter((c) => c.factId).map((c) => [c.id, c.factId!]));
  return [...store.log]
    .reverse()
    .filter((e) => filter.value === "all" || e.type.startsWith(filter.value))
    .filter((e) => {
      // Events about a fact are shown only when that fact is in scope; meeting-level events to everyone.
      const fid = eventFact(e, store.records, claimFacts);
      return !fid || store.scope.facts.has(fid);
    })
    .slice(0, 300);
});
</script>

<template>
  <section class="card" aria-labelledby="act-h">
    <div class="head">
      <h1 id="act-h">Activity</h1>
      <span class="muted small">events in your scope, newest first</span>
      <label for="type" class="muted small filter-label">Type</label>
      <select id="type" v-model="filter">
        <option v-for="(label, key) in groups" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <p v-if="!shown.length" class="empty">No events since the last reseed.</p>
    <div class="scroll">
      <ol>
        <li v-for="e in shown" :key="e.seq">
          <span class="num muted">{{ e.seq }}</span>
          <span class="muted">{{ clock(e.at) }}</span>
          <span><Pill :tone="EVENT_TONE[e.type] ?? 'quiet'">{{ e.type }}</Pill></span>
          <span class="sum">{{ summarize(e, store.records) }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.head { padding: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.head h1 { font-size: 1.25rem; }
.filter-label { margin-left: auto; }
select { min-height: 44px; background: var(--raised); color: var(--fg); border: 1px solid var(--border); border-radius: var(--r-btn); padding: 0 12px; font: inherit; font-size: 0.875rem; }
.scroll { overflow-x: auto; }
ol { list-style: none; margin: 0; padding: 0; min-width: 640px; }
li { display: grid; grid-template-columns: 56px 90px 150px minmax(0, 1fr); gap: 12px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--rule); font-size: 0.8125rem; }
.sum { overflow-wrap: anywhere; }
.empty { padding: 0 16px 20px; color: var(--muted); }
</style>
