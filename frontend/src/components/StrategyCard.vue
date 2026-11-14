<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { personName } from "../lib/format";
import { factStatus, strategyStatus, TIER } from "../lib/labels";
import { effectiveTier } from "../lib/scope";
import { useInlook } from "../stores/inlook";
import type { Strategy } from "../types";
import Pill from "./Pill.vue";

const props = defineProps<{ strategy: Strategy; showValues?: boolean }>();
const store = useInlook();
const status = computed(() => strategyStatus(props.strategy));
const mine = computed(() => props.strategy.owners.includes(store.viewer?.id ?? ""));
const facts = computed(() => props.strategy.factIds.map((id) => store.records.facts[id]).filter(Boolean));
const owners = computed(() => props.strategy.owners.map((id) => personName(id, store.records)).join(", "));
</script>

<template>
  <article class="strategy" :class="{ flagged: strategy.status === 'flagged' }">
    <div class="head">
      <h3>{{ strategy.name }}</h3>
      <Pill :tone="mine ? 'low' : 'quiet'">{{ mine ? "Yours" : "Your team" }}</Pill>
      <Pill class="status" :tone="status.tone">{{ status.label }}</Pill>
    </div>
    <p v-if="strategy.summary" class="small summary">{{ strategy.summary }}</p>
    <p class="muted small">{{ strategy.owners.length > 1 ? "Owners" : "Owner" }}: {{ owners }}</p>
    <p class="label relies">Relies on</p>
    <ul>
      <li v-for="f in facts" :key="f.id">
        <RouterLink :to="`/facts/${f.id}`">{{ f.label }}</RouterLink>
        <span v-if="showValues" class="muted"> · {{ f.value }}</span>
        <Pill v-if="showValues" class="tier" :tone="TIER[effectiveTier(f.id, f.tier, store.records.strategies)].tone">{{ TIER[effectiveTier(f.id, f.tier, store.records.strategies)].label }}</Pill>
        <Pill :class="showValues ? '' : 'status'" :tone="factStatus(f).tone">{{ factStatus(f).label }}</Pill>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.strategy { border: 1px solid var(--border); border-radius: 0.75rem; padding: 14px 16px; }
.strategy.flagged { border-color: var(--danger); background: var(--tint-danger); }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
h3 { font-size: 0.9375rem; font-weight: 600; }
.status, .tier { margin-left: auto; }
.summary { margin: 4px 0 2px; line-height: 1.4; }
.relies { margin-top: 10px; font-size: 0.6875rem; }
ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
li { display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
li a { color: var(--fg); }
</style>
