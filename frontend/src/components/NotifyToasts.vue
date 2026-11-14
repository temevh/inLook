<script setup lang="ts">
// Pop-ups for notifications that arrive while the page is open, each with its main action.
// Notifications that were already there (on load, after Reset or after switching person) don't pop up.
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { InboxItem } from "../lib/inbox";
import { useInlook } from "../stores/inlook";
import Pill from "./Pill.vue";

const store = useInlook();
const router = useRouter();
const SHOW_MS = 9000;
const MAX = 3;

const shown = ref<InboxItem[]>([]);
let known = new Set<string>();
let baseline = true;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function close(key: string) {
  shown.value = shown.value.filter((i) => i.key !== key);
  clearTimeout(timers.get(key));
  timers.delete(key);
}
function act(item: InboxItem) {
  close(item.key);
  void router.push(item.actions[0].to);
}
function rebaseline() {
  baseline = true;
  for (const k of [...timers.keys()]) close(k);
}

watch(() => [store.viewerId, store.mode], rebaseline);
watch(() => store.log.length, (n, old) => { if (n < old) rebaseline(); });
watch(
  () => (store.loading ? null : store.inbox),
  (items) => {
    if (!items) return;
    if (baseline) { known = new Set(items.map((i) => i.key)); baseline = false; return; }
    const fresh = items.filter((i) => !known.has(i.key));
    for (const i of items) known.add(i.key);
    for (const item of fresh.reverse()) {
      shown.value = [item, ...shown.value].slice(0, MAX);
      timers.set(item.key, setTimeout(() => close(item.key), SHOW_MS));
    }
  },
);
</script>

<template>
  <div class="stack" aria-live="polite">
    <TransitionGroup name="slide">
      <article v-for="item in shown" :key="item.key" class="note card">
        <div class="head">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          <Pill :tone="item.tone">{{ item.kind }}</Pill>
          <button class="x" type="button" aria-label="Close" @click="close(item.key)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p class="small text">{{ item.text }}</p>
        <button class="btn" :class="{ primary: item.actions[0].label === 'Decide now' }" type="button" @click="act(item)">{{ item.actions[0].label }}</button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.stack { position: fixed; right: 24px; bottom: 24px; z-index: 40; display: flex; flex-direction: column-reverse; gap: 10px; width: min(380px, calc(100vw - 32px)); pointer-events: none; }
.note { pointer-events: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; border-color: var(--navy); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); }
.head { display: flex; align-items: center; gap: 8px; color: var(--accent); }
.x { margin-left: auto; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--r-btn); background: none; color: var(--muted); cursor: pointer; }
.x:hover { background: var(--raised); color: var(--fg); }
.text { line-height: 1.45; }
.note .btn { align-self: flex-start; min-height: 36px; padding: 6px 14px; }
.slide-enter-active, .slide-leave-active { transition: opacity 0.25s var(--ease), transform 0.25s var(--ease); }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateX(24px); }
@media (prefers-reduced-motion: reduce) { .slide-enter-active, .slide-leave-active { transition: none; } }
</style>
