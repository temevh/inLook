<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useInlook } from "../stores/inlook";
import NotificationBell from "./NotificationBell.vue";
import UserMenu from "./UserMenu.vue";

const store = useInlook();
/** Phones only: Live / Demo, Play and Reset sit behind a menu button so the bar stays one line. */
const menuOpen = ref(false);
function onDoc() { menuOpen.value = false; }
onMounted(() => document.addEventListener("click", onDoc));
onUnmounted(() => document.removeEventListener("click", onDoc));


const conn = computed(() => {
  if (store.mode === "demo" && store.waking) return { label: "Waking the demo backend…", cls: "navy" };
  if (store.mode === "demo" && store.backed && store.connection === "live") return { label: store.playing ? "Mock backend · receiving" : `Mock backend · seq ${store.lastSeq}`, cls: store.playing ? "primary" : "ok" };
  if (store.mode === "demo" && !store.backed) return { label: store.playing ? "Demo · receiving" : `Demo data · seq ${store.lastSeq}`, cls: store.playing ? "primary" : "ok" };
  switch (store.connection) {
    case "live": return { label: `Live · seq ${store.lastSeq}`, cls: "ok" };
    case "connecting": return { label: "Connecting…", cls: "navy" };
    case "reconnecting": return { label: "Reconnecting…", cls: "warn" };
    default: return { label: "Backend offline", cls: "bad" };
  }
});
const playLabel = computed(() => (store.playing ? "Pause" : store.meetingDone ? "Meeting over" : store.meetingIndex ? "Resume meeting" : "Play meeting"));
</script>

<template>
  <header class="bar">
    <div class="brand">in<span>Look</span></div>
    <span class="mock">Mock data</span>

    <div class="right">
      <div id="bar-controls" class="controls" :class="{ open: menuOpen }">
        <p class="state muted small">{{ conn.label }}</p>
        <div class="seg" role="group" aria-label="Data source">
          <button type="button" :aria-pressed="store.mode === 'live'" @click="store.setMode('live')">Live</button>
          <button type="button" :aria-pressed="store.mode === 'demo'" @click="store.setMode('demo')">Demo</button>
        </div>
        <button class="btn" type="button" :disabled="store.meetingDone && !store.playing" @click="store.playMeeting()">{{ playLabel }}</button>
        <button v-if="store.mode === 'demo'" class="btn ghost" type="button" @click="store.resetDemo()">Reset</button>
      </div>
      <span class="conn" :class="conn.cls" role="status" :title="conn.label"><span class="dot" aria-hidden="true" /><span class="lbl">{{ conn.label }}</span></span>
      <NotificationBell v-if="store.viewer" />
      <UserMenu />
      <button
        class="more" type="button" aria-controls="bar-controls" :aria-expanded="menuOpen" aria-label="Data source and meeting controls"
        @click.stop="menuOpen = !menuOpen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 12px 24px; border-bottom: 1px solid var(--border); }
.brand { font-weight: 800; font-size: 1.375rem; letter-spacing: -0.02em; }
.brand span { color: var(--primary); }
.mock { background: var(--warning); color: #fff; border-radius: 999px; padding: 3px 10px; font-size: 0.75rem; font-weight: 600; }
.right { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--r-btn); overflow: hidden; }
.seg button { min-height: 42px; padding: 0 14px; background: transparent; border: 0; font-size: 0.875rem; font-weight: 600; cursor: pointer; color: var(--muted); }
.seg button[aria-pressed="true"] { background: var(--navy-900); color: var(--fg); }
.conn { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 6px 12px; font-size: 0.75rem; font-weight: 600; color: #fff; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
.ok { background: var(--success); } .warn { background: var(--warning); } .bad { background: var(--danger); }
.navy { background: var(--navy-700); } .primary { background: var(--brand); }
/* Wider screens: the controls sit inline as before, and the menu button is not shown. */
.controls { display: contents; }
.state, .more { display: none; }

/* Phones: one line (brand, status dot, bell, person, menu); the controls open from the menu button. */
@media (max-width: 640px) {
  .bar { position: relative; flex-wrap: nowrap; gap: 8px; padding: 8px 16px; }
  .brand { font-size: 1.2rem; }
  .mock { padding: 2px 8px; font-size: 0.6875rem; white-space: nowrap; }
  .right { flex-wrap: nowrap; gap: 6px; }
  .conn { padding: 0; width: 26px; height: 26px; justify-content: center; flex: none; }
  .conn .lbl { display: none; }
  .more { display: inline-flex; flex: none; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: var(--r-btn); border: 1px solid var(--border); background: var(--raised); color: var(--fg); cursor: pointer; }
  .more[aria-expanded="true"] { border-color: var(--primary); }
  .controls { display: none; }
  .controls.open {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px; position: absolute; z-index: 25; top: calc(100% + 6px); left: 16px; right: 16px;
    padding: 12px; background: var(--card); border: 1px solid var(--border); border-radius: var(--r-card); box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
  }
  .controls.open .state { display: block; flex-basis: 100%; }
  .controls.open .btn { flex: 1 1 auto; }
}
</style>
