<script setup lang="ts">
import { computed } from "vue";
import StrategyCard from "../components/StrategyCard.vue";
import { useRoute } from "vue-router";
import { useInlook } from "../stores/inlook";

const store = useInlook();
const route = useRoute();
const list = computed(() =>
  [...store.scope.strategies].sort(
    (a, b) =>
      Number(b.status === "flagged") - Number(a.status === "flagged") ||
      Number(b.owners.includes(store.viewer?.id ?? "")) - Number(a.owners.includes(store.viewer?.id ?? "")) ||
      a.name.localeCompare(b.name),
  ),
);
</script>

<template>
  <div class="page">
    <div class="head">
      <h1>Strategies</h1>
    </div>
    <p v-if="!list.length" class="card empty">No strategy is owned by you or anyone below you.</p>
    <div class="grid">
      <div v-for="s in list" :id="`strategy-${s.id}`" :key="s.id" class="card wrap" :class="{ highlight: route.hash === `#strategy-${s.id}` }"><StrategyCard :strategy="s" show-values /></div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.head h1 { font-size: 1.25rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
.wrap { padding: 4px; scroll-margin-top: 140px; }
.wrap.highlight { box-shadow: 0 0 0 3px var(--primary); }
.wrap :deep(.strategy) { border: 0; height: 100%; }
.empty { padding: 20px; color: var(--muted); }
</style>
