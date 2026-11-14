<script setup lang="ts">
import { computed } from "vue";
import type { Claim } from "../lib/fold";
import { SOURCE_LABEL } from "../lib/format";
import { CLAIM } from "../lib/labels";
import Pill from "./Pill.vue";

const props = defineProps<{ claim: Claim; inScope: boolean }>();
const state = computed(() => CLAIM[props.claim.state]);
const detail = computed(() => {
  const c = props.claim;
  if (c.state === "outdated") return `${c.oldValue} → ${c.newValue} · ${c.tier === "low" ? "updated automatically" : "in review"}`;
  if (c.state === "current") return `Matches ${c.oldValue}`;
  if (c.state === "unverified") return "No matching fact in company memory";
  if (c.state === "unverifiable") return "No public source to check it against";
  return "";
});
</script>

<template>
  <article class="claim" :class="claim.state">
    <div class="tags">
      <Pill :tone="state.tone">{{ state.label }}</Pill>
      <span class="muted small">{{ SOURCE_LABEL[claim.source] ?? claim.source }}<template v-if="claim.speaker"> · {{ claim.speaker }}</template></span>
      <Pill v-if="inScope" tone="low">In your scope</Pill>
    </div>
    <p class="text">“{{ claim.text }}”</p>
    <p v-if="detail" class="muted small">{{ detail }}</p>
  </article>
</template>

<style scoped>
.claim { border: 1px solid var(--border); border-radius: 0.75rem; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.claim.checking { border-color: var(--primary); background: var(--tint-primary); }
.claim.outdated { border-color: var(--danger); background: var(--tint-danger); }
.claim.unverified, .claim.unverifiable { border-style: dashed; }
.tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.text { font-size: 0.875rem; line-height: 1.4; }
</style>
