<script setup lang="ts">
// How one fact reaches people: the fact, the strategies that rely on it, and their owners.
// Edges light up while a change to the fact is in review; reviewers and flagged strategies are marked.
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { personName } from "../lib/format";
import { TIER } from "../lib/labels";
import { effectiveTier } from "../lib/scope";
import { useInlook } from "../stores/inlook";
import type { Fact } from "../types";

const props = defineProps<{ fact: Fact }>();
const store = useInlook();

const ROW = 64; // px per row
const BOX = 50; // box height
const COL = { fact: [0, 28], strategy: [36, 64], owner: [72, 100] } as const; // left/right edges, % of width

const tier = computed(() => effectiveTier(props.fact.id, props.fact.tier, store.records.strategies));
const strategies = computed(() => Object.values(store.records.strategies).filter((s) => s.factIds.includes(props.fact.id)));
const ownerIds = computed(() => [...new Set(strategies.value.flatMap((s) => s.owners))]);
const review = computed(() => Object.values(store.records.reviews).find((r) => r.factId === props.fact.id && r.status === "pending"));
const hot = computed(() => !!review.value);
const rows = computed(() => Math.max(strategies.value.length, ownerIds.value.length, 1));
const height = computed(() => rows.value * ROW);

const centre = (i: number, n: number) => (height.value - n * ROW) / 2 + i * ROW + ROW / 2;
const factY = computed(() => height.value / 2);
const sY = (i: number) => centre(i, strategies.value.length);
const oY = (i: number) => centre(i, ownerIds.value.length);

/** Edges in a 100 × height box, drawn as gentle S-curves. */
function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}
const factEdges = computed(() => strategies.value.map((s, i) => ({ key: s.id, d: curve(COL.fact[1], factY.value, COL.strategy[0], sY(i)), flagged: s.status === "flagged" })));
const ownerEdges = computed(() =>
  strategies.value.flatMap((s, i) => s.owners.map((o) => ({
    key: `${s.id}-${o}`, d: curve(COL.strategy[1], sY(i), COL.owner[0], oY(ownerIds.value.indexOf(o))),
    asked: !!review.value?.reviewers.includes(o),
  }))),
);
const edgeClass = computed(() => (hot.value ? (tier.value === "high" ? "high" : "medium") : ""));
const box = (col: readonly [number, number], y: number) => ({ left: `${col[0]}%`, width: `${col[1] - col[0]}%`, top: `${y - BOX / 2}px`, height: `${BOX}px` });
const asked = (id: string) => !!review.value?.reviewers.includes(id);
</script>

<template>
  <section class="card ripple" aria-labelledby="rip-h">
    <div class="head">
      <h2 id="rip-h">How a change ripples</h2>
      <span class="muted small">
        <template v-if="!strategies.length">No strategy relies on {{ fact.label }}, so a change only reaches {{ personName(fact.statedBy, store.records) }}, who stated it.</template>
        <template v-else-if="tier !== 'high'">{{ TIER[tier].label }} tier: a change goes to {{ personName(fact.statedBy, store.records) }} only; these strategies wait for that decision.</template>
      </span>
    </div>

    <div v-if="strategies.length" class="canvas">
    <div class="cols" aria-hidden="true">
      <span class="col fact" :style="{ left: `${COL.fact[0]}%`, width: `${COL.fact[1] - COL.fact[0]}%` }"><i class="dot" />Fact</span>
      <span class="col strategy" :style="{ left: `${COL.strategy[0]}%`, width: `${COL.strategy[1] - COL.strategy[0]}%` }"><i class="dot" />Strategies relying on it · {{ strategies.length }}</span>
      <span class="col owner" :style="{ left: `${COL.owner[0]}%`, width: `${COL.owner[1] - COL.owner[0]}%` }"><i class="dot" />Owners · {{ ownerIds.length }}</span>
    </div>
    <div class="graph" :style="{ height: `${height}px` }">
      <svg class="edges" :viewBox="`0 0 100 ${height}`" preserveAspectRatio="none" aria-hidden="true">
        <path v-for="e in factEdges" :key="e.key" :d="e.d" :class="[edgeClass, { flagged: e.flagged }]" />
        <path v-for="e in ownerEdges" :key="e.key" :d="e.d" :class="[edgeClass && e.asked ? edgeClass : '', { asked: e.asked }]" />
      </svg>

      <div class="node fact" :class="{ hot }" :style="box(COL.fact, factY)">
        <strong>{{ fact.label }}</strong>
        <span class="muted">{{ hot ? `${review!.oldValue} → ${review!.newValue}` : fact.value }}</span>
      </div>

      <RouterLink
        v-for="(s, i) in strategies" :key="s.id" :to="`/strategies#strategy-${s.id}`"
        class="node strategy" :class="{ flagged: s.status === 'flagged' }" :style="box(COL.strategy, sY(i))"
      >
        <strong>{{ s.name }}</strong>
        <span class="muted">{{ s.status === "flagged" ? "Flagged" : "Healthy" }}</span>
      </RouterLink>

      <div v-for="(id, i) in ownerIds" :key="id" class="node owner" :class="{ asked: asked(id), me: id === store.viewer?.id }" :style="box(COL.owner, oY(i))">
        <strong>{{ personName(id, store.records) }}{{ id === store.viewer?.id ? " (you)" : "" }}</strong>
        <span class="muted">{{ asked(id) ? "Asked to decide" : store.records.people[id]?.role }}</span>
      </div>
    </div>
    </div>

    <div class="legend muted small">
      <span><i class="sw hot" /> change in review</span>
      <span><i class="sw flagged" /> flagged strategy</span>
      <span><i class="sw asked" /> asked to decide</span>
    </div>
  </section>
</template>

<style scoped>
.ripple { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.head h2 { font-size: 1rem; }
.canvas { --k-fact: #a78bfa; --k-strategy: #2dd4bf; --k-owner: #f472b6; min-width: 560px; display: flex; flex-direction: column; gap: 8px; }
.cols { position: relative; height: 18px; }
.col { position: absolute; top: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.col .dot { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.col.fact { color: var(--k-fact); } .col.fact .dot { background: var(--k-fact); }
.col.strategy { color: var(--k-strategy); } .col.strategy .dot { background: var(--k-strategy); }
.col.owner { color: var(--k-owner); } .col.owner .dot { background: var(--k-owner); border-radius: 50%; }
.graph { position: relative; }
.edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.edges path { fill: none; stroke: var(--border); stroke-width: 1.5; vector-effect: non-scaling-stroke; transition: stroke 0.3s var(--ease); }
.edges path.medium { stroke: #f0b44c; stroke-dasharray: 6 5; animation: flow 1s linear infinite; }
.edges path.high { stroke: #ff6b6b; stroke-dasharray: 6 5; animation: flow 1s linear infinite; }
@keyframes flow { to { stroke-dashoffset: -11; } }
@media (prefers-reduced-motion: reduce) { .edges path { animation: none !important; } }
.node { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 0.75rem; background: var(--raised); font-size: 0.8125rem; line-height: 1.25; overflow: hidden; }
.node { border-color: color-mix(in srgb, var(--kind) 35%, var(--border)); }
.node.fact { --kind: var(--k-fact); }
.node.strategy { --kind: var(--k-strategy); }
.node.owner { --kind: var(--k-owner); }
.node strong, .node span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.node span { font-size: 0.75rem; }
.node.fact.hot { border-color: var(--warning); background: var(--tint-warning); }
a.node { color: var(--fg); text-decoration: none; }
a.node:hover { border-color: var(--accent); }
.node.strategy.flagged { border-color: var(--danger); background: var(--tint-danger); }
.node.owner.asked { border-color: var(--primary); background: var(--tint-primary); }
.node.owner.me strong { color: var(--accent); }
.legend { display: flex; flex-wrap: wrap; gap: 14px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { display: inline-block; width: 14px; height: 10px; border-radius: 3px; border: 1px solid; }
.sw.hot { border-color: var(--warning); background: var(--tint-warning); }
.sw.flagged { border-color: var(--danger); background: var(--tint-danger); }
.sw.asked { border-color: var(--primary); background: var(--tint-primary); }
</style>
