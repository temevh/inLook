<script setup lang="ts">
import { computed } from "vue";
import { useInlook } from "../stores/inlook";
import NotificationBell from "./NotificationBell.vue";
import UserMenu from "./UserMenu.vue";

const store = useInlook();


const conn = computed(() => {
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
      <div class="seg" role="group" aria-label="Data source">
        <button type="button" :aria-pressed="store.mode === 'live'" @click="store.setMode('live')">Live</button>
        <button type="button" :aria-pressed="store.mode === 'demo'" @click="store.setMode('demo')">Demo</button>
      </div>
      <button class="btn" type="button" :disabled="store.meetingDone && !store.playing" @click="store.playMeeting()">{{ playLabel }}</button>
      <button v-if="store.mode === 'demo'" class="btn ghost" type="button" @click="store.resetDemo()">Reset</button>
      <span class="conn" :class="conn.cls" role="status"><span class="dot" aria-hidden="true" />{{ conn.label }}</span>
      <NotificationBell v-if="store.viewer" />
      <UserMenu />
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
</style>
