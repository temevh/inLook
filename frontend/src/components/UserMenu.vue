<script setup lang="ts">
// The signed-in person. In demo mode it opens a list of everyone, so a demo can switch person
// without reloading and losing what has happened. Live mode has no switching: there is one real user.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useInlook } from "../stores/inlook";

const store = useInlook();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const canSwitch = computed(() => store.mode === "demo");
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const waiting = (id: string) => Object.values(store.records.reviews).filter((r) => r.status === "pending" && r.reviewers.includes(id)).length;

function pick(id: string) {
  store.setViewer(id);
  open.value = false;
}
function onDoc(e: MouseEvent) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false; }
function onKey(e: KeyboardEvent) { if (e.key === "Escape") open.value = false; }
onMounted(() => { document.addEventListener("click", onDoc); document.addEventListener("keydown", onKey); });
onUnmounted(() => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div v-if="store.viewer" ref="root" class="user-wrap">
    <component
      :is="canSwitch ? 'button' : 'div'" class="user" :class="{ switch: canSwitch }"
      :type="canSwitch ? 'button' : undefined" :aria-expanded="canSwitch ? open : undefined" :aria-haspopup="canSwitch ? 'listbox' : undefined"
      :aria-label="`Signed in as ${store.viewer.name}${canSwitch ? '. Switch person' : ''}`" @click.stop="canSwitch && (open = !open)"
    >
      <span class="av" aria-hidden="true">{{ initials(store.viewer.name) }}</span>
      <span class="who"><strong>{{ store.viewer.name }}</strong><span class="muted">{{ store.viewer.role }}</span></span>
      <svg v-if="canSwitch" class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </component>

    <Transition name="pop">
      <section v-if="open" class="menu card" aria-label="Sign in as">
        <header><h2>Sign in as</h2><span class="muted small">Demo only · keeps the demo running</span></header>
        <ul role="listbox" :aria-activedescendant="`person-${store.viewer.id}`">
          <li v-for="{ person, depth } in store.org" :id="`person-${person.id}`" :key="person.id" role="option" :aria-selected="person.id === store.viewer.id">
            <button type="button" :style="{ paddingLeft: `${12 + depth * 16}px` }" @click="pick(person.id)">
              <span class="av sm" aria-hidden="true">{{ initials(person.name) }}</span>
              <span class="who"><strong>{{ person.name }}</strong><span class="muted">{{ person.role }}</span></span>
              <span v-if="person.id === store.viewer.id" class="tag you">You</span>
              <span v-else-if="waiting(person.id)" class="tag warn" :title="`${waiting(person.id)} decision(s) waiting`">{{ waiting(person.id) }} to decide</span>
            </button>
          </li>
        </ul>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.user-wrap { position: relative; padding-left: 16px; margin-left: 8px; border-left: 1px solid var(--border); }
.user { display: flex; align-items: center; gap: 10px; background: none; border: 1px solid transparent; border-radius: var(--r-btn); padding: 4px 8px 4px 4px; color: var(--fg); font: inherit; text-align: left; }
.user.switch { cursor: pointer; }
.user.switch:hover, .user[aria-expanded="true"] { border-color: var(--border); background: var(--raised); }
.who { display: flex; flex-direction: column; font-size: 0.875rem; line-height: 1.25; }
.who .muted { font-size: 0.75rem; }
.av { flex: none; width: 36px; height: 36px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800; background: var(--brand); color: #fff; }
.av.sm { width: 28px; height: 28px; font-size: 0.625rem; background: var(--navy-700); }
.chev { color: var(--muted); }
.menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 20; width: min(360px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 100px)); display: flex; flex-direction: column; box-shadow: 0 16px 40px rgb(0 0 0 / 0.5); }
header { padding: 14px 16px 10px; border-bottom: 1px solid var(--rule); display: flex; flex-direction: column; gap: 2px; }
header h2 { font-size: 1rem; }
ul { list-style: none; margin: 0; padding: 6px; overflow-y: auto; }
li button { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 12px; border: 0; border-radius: var(--r-btn); background: none; color: var(--fg); font: inherit; text-align: left; cursor: pointer; }
li button:hover { background: #191c27; }
li[aria-selected="true"] button { background: var(--tint-primary); }
.tag { margin-left: auto; border-radius: 999px; padding: 3px 10px; font-size: 0.6875rem; font-weight: 600; color: #fff; white-space: nowrap; }
.tag.you { background: var(--navy); } .tag.warn { background: var(--warning); }
.pop-enter-active, .pop-leave-active { transition: opacity 0.18s var(--ease), transform 0.18s var(--ease); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-6px); }
@media (prefers-reduced-motion: reduce) { .pop-enter-active, .pop-leave-active { transition: none; } }
</style>
