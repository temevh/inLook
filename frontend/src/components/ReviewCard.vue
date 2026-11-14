<script setup lang="ts">
import { computed } from "vue";
import { domain, personName } from "../lib/format";
import { whyReviewer } from "../lib/routing";
import { TIER } from "../lib/labels";
import { useInlook } from "../stores/inlook";
import type { Review } from "../types";
import Pill from "./Pill.vue";

const props = defineProps<{ review: Review; highlight?: boolean }>();
const store = useInlook();

const fact = computed(() => store.records.facts[props.review.factId]);
const canAct = computed(() => props.review.reviewers.includes(store.viewer?.id ?? ""));
const reviewers = computed(() => props.review.reviewers.map((id) => personName(id, store.records)).join(", "));
const onTeam = computed(() => !canAct.value && props.review.reviewers.some((id) => store.scope.team.has(id)));
const why = computed(() => whyReviewer(fact.value, props.review.tier, props.review.reviewers, store.records));
const busy = computed(() => !!store.busy[props.review.id]);
</script>

<template>
  <article :id="`review-${review.id}`" class="review" :class="{ mine: canAct, [review.tier]: canAct, highlight }">
    <header>
      <span class="label">Proposed change</span>
      <Pill :tone="TIER[review.tier].tone">{{ TIER[review.tier].label }}</Pill>
    </header>
    <div class="body">
      <h3>{{ fact?.label ?? review.factId }}</h3>
      <div class="change">
        <span class="old">{{ review.oldValue }}</span>
        <span class="muted" aria-hidden="true">→</span>
        <span class="new">{{ review.newValue }}</span>
      </div>
      <blockquote>
        “{{ review.evidence }}”
        <a v-if="fact?.sourceUrl" :href="fact.sourceUrl" target="_blank" rel="noopener">{{ domain(fact.sourceUrl) }}</a>
      </blockquote>
      <p class="muted small">{{ why }}</p>
      <div v-if="canAct" class="actions">
        <button class="btn primary" type="button" :disabled="busy" @click="store.decide(review.id, 'accept')">
          <span v-if="busy" class="spinner" aria-hidden="true" />{{ busy ? "Saving…" : "Accept new value" }}
        </button>
        <button class="btn" type="button" :disabled="busy" @click="store.decide(review.id, 'reject')">Keep old value</button>
      </div>
      <p v-else class="waiting">Waiting on {{ reviewers }}<span v-if="onTeam"> (your team)</span></p>
    </div>
  </article>
</template>

<style scoped>
.review { border: 1px solid var(--border); border-radius: var(--r-card); overflow: hidden; }
.review.mine.high { border-color: var(--danger); }
.review.mine.medium { border-color: var(--warning); }
.review.highlight { box-shadow: 0 0 0 3px var(--primary); }
header { background: var(--raised); padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.body { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
h3 { font-size: 1rem; font-weight: 600; }
.change { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.old { color: var(--muted); text-decoration: line-through; }
.new { font-size: 1.5rem; font-weight: 800; }
blockquote { margin: 0; padding: 10px 12px; background: var(--sunken); border-radius: var(--r-btn); font-size: 0.8125rem; line-height: 1.45; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.waiting { margin-top: 4px; padding: 10px 14px; border-radius: 999px; background: var(--raised); font-size: 0.8125rem; }
</style>
