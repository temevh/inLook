<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useInlook } from "../stores/inlook";
import Pill from "./Pill.vue";

const store = useInlook();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
/** Read state as it was when the panel opened, so new items keep their dot while it is open. */
const seenWhenOpened = ref("");

function toggle() {
  open.value = !open.value;
  if (open.value) { seenWhenOpened.value = store.seenAt; store.markRead(); }
}
function go(to: string) {
  open.value = false;
  void router.push(to);
}
const isNew = (at: string) => at > seenWhenOpened.value;
const badge = computed(() => (store.unread > 9 ? "9+" : String(store.unread)));

function onDoc(e: MouseEvent) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false; }
function onKey(e: KeyboardEvent) { if (e.key === "Escape") open.value = false; }
onMounted(() => { document.addEventListener("click", onDoc); document.addEventListener("keydown", onKey); });
onUnmounted(() => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div ref="root" class="bell-wrap">
    <button
      class="bell" type="button" :aria-expanded="open" aria-haspopup="dialog"
      :aria-label="store.unread ? `Notifications, ${store.unread} unread` : 'Notifications'" @click.stop="toggle"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span v-if="store.unread" class="badge">{{ badge }}</span>
    </button>

    <Transition name="pop">
      <section v-if="open" class="panel card" role="dialog" aria-label="Notifications">
        <header>
          <h2>Notifications</h2>
          <span class="muted small">{{ store.inbox.length }} shown{{ store.hiddenCount ? ` · ${store.hiddenCount} hidden` : "" }}</span>
          <button v-if="store.inbox.length" class="link" type="button" @click="store.hideAll()">Hide all</button>
        </header>

        <p v-if="!store.inbox.length" class="empty">
          {{ store.hiddenCount ? "You've hidden everything." : "Nothing for you yet. inLook only writes to the people who own what changed." }}
        </p>
        <TransitionGroup v-else name="list" tag="ul" class="items">
          <li v-for="m in store.inbox" :key="m.key" class="item" :class="{ new: isNew(m.at) }">
            <div class="item-head">
              <span v-if="isNew(m.at)" class="dot" aria-label="New" />
              <Pill :tone="m.tone">{{ m.kind }}</Pill>
              <span class="muted small">{{ m.meta }}</span>
              <button class="hide" type="button" :aria-label="`Hide: ${m.text}`" title="Hide" @click="store.hide(m.key)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <p class="small text">{{ m.text }}</p>
            <div class="actions">
              <button
                v-for="(a, i) in m.actions" :key="a.to" type="button" class="act" :class="{ primary: i === 0 && a.label === 'Decide now' }"
                @click="go(a.to)"
              >{{ a.label }}</button>
            </div>
          </li>
        </TransitionGroup>

        <footer v-if="store.hiddenCount">
          <button class="link" type="button" @click="store.unhideAll()">Show {{ store.hiddenCount }} hidden</button>
        </footer>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.bell-wrap { position: relative; }
.bell { position: relative; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-btn); border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
.bell:hover, .bell[aria-expanded="true"] { border-color: var(--primary); }
.badge { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--danger); color: #fff; font-size: 0.6875rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; border: 2px solid var(--page); }
.panel { position: absolute; right: 0; top: calc(100% + 8px); z-index: 20; width: min(440px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 100px)); display: flex; flex-direction: column; box-shadow: 0 16px 40px rgb(0 0 0 / 0.5); }
header { display: flex; align-items: baseline; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--rule); }
header h2 { font-size: 1rem; }
header .link { margin-left: auto; }
.link { background: none; border: 0; padding: 4px 0; color: var(--accent); font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.link:hover { color: #92b1f5; }
.empty { padding: 24px 16px; color: var(--muted); font-size: 0.875rem; line-height: 1.5; text-align: center; }
.items { list-style: none; margin: 0; padding: 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.item { padding: 12px; border-radius: 0.75rem; border: 1px solid transparent; display: flex; flex-direction: column; gap: 8px; }
.item:hover { background: #191c27; }
.item.new { border-color: var(--border); background: var(--tint-primary); }
.item-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }
.hide { margin-left: auto; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-btn); border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.hide:hover { background: var(--raised); color: var(--fg); }
.text { line-height: 1.45; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.act { min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--raised); color: var(--fg); font: inherit; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.act:hover { border-color: var(--accent); }
.act.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.act.primary:hover { background: var(--brand-hover); }
footer { padding: 10px 16px; border-top: 1px solid var(--rule); }
.pop-enter-active, .pop-leave-active { transition: opacity 0.18s var(--ease), transform 0.18s var(--ease); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-6px); }
@media (prefers-reduced-motion: reduce) { .pop-enter-active, .pop-leave-active { transition: none; } }
/* Phones: a smaller button, and the panel opens across the screen under the top bar. */
@media (max-width: 640px) {
  .bell { width: 40px; height: 40px; }
  .panel { position: fixed; top: 60px; left: 16px; right: 16px; width: auto; max-height: calc(100vh - 80px); }
}
</style>
