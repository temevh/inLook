<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { RouterLink, RouterView } from "vue-router";
import AppHeader from "./components/AppHeader.vue";
import NotifyToasts from "./components/NotifyToasts.vue";
import { useInlook } from "./stores/inlook";

const store = useInlook();
onMounted(() => store.start());
onUnmounted(() => store.stop());

const waiting = computed(() => store.scope.reviews.filter((r) => r.status === "pending" && r.reviewers.includes(store.viewer?.id ?? "")).length);
const flagged = computed(() => store.scope.strategies.filter((s) => s.status === "flagged").length);

const banner = computed(() => {
  if (store.mode === "demo") return null;
  if (store.connection === "offline")
    return { tone: "bad", title: "Backend offline.", text: "Can't reach the live stream. What you see may be out of date, and decisions are paused." };
  if (store.apiError)
    return { tone: "bad", title: "Company memory unavailable.", text: `The data API answered: ${store.apiError}. Start it with npm run api, or use demo data.` };
  if (store.connection === "reconnecting")
    return { tone: "warn", title: "Reconnecting.", text: "The live stream dropped; the browser is retrying." };
  return null;
});
</script>

<template>
  <div class="shell">
    <div class="top">
    <AppHeader />
    <nav class="tabs" aria-label="Views">
      <RouterLink to="/" class="tab">My desk <span v-if="waiting" class="count warn">{{ waiting }}</span></RouterLink>
      <RouterLink to="/facts" class="tab">Facts</RouterLink>
      <RouterLink to="/strategies" class="tab">Strategies <span v-if="flagged" class="count bad">{{ flagged }}</span></RouterLink>
      <RouterLink to="/meetings" class="tab">Meetings <span v-if="store.playing" class="live-dot" aria-label="in progress" /></RouterLink>
      <RouterLink to="/activity" class="tab">Activity</RouterLink>
    </nav>
    </div>

    <div v-if="banner" class="banner" :class="banner.tone" role="status">
      <span><strong>{{ banner.title }}</strong> {{ banner.text }}</span>
      <span class="actions">
        <button class="btn" type="button" @click="store.start()">Retry</button>
        <button class="btn" type="button" @click="store.setMode('demo')">Use demo data</button>
      </span>
    </div>

    <Transition name="list">
      <div v-if="store.toast" class="toast" :class="store.toast.tone" role="status">{{ store.toast.text }}</div>
    </Transition>

    <NotifyToasts />

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
/* Header and tabs stay on screen while the page scrolls. */
.top { position: sticky; top: 0; z-index: 30; background: var(--page); box-shadow: 0 1px 0 var(--border), 0 8px 24px rgb(0 0 0 / 0.25); }
.tabs { display: flex; flex-wrap: wrap; gap: 24px; padding: 0 24px; border-bottom: 1px solid var(--border); }
.tab { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 12px 2px; color: var(--muted); text-decoration: none; font-weight: 600; font-size: 0.875rem; border-bottom: 2px solid transparent; }
.tab:hover { color: var(--fg); }
.tab.router-link-exact-active, .tab.router-link-active:not([href="/"]) { color: var(--fg); border-bottom-color: var(--primary); }
.count { border-radius: 999px; padding: 1px 8px; font-size: 0.75rem; color: #fff; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); animation: pulse 1.4s var(--ease) infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .live-dot { animation: none; } }
.count.warn { background: var(--warning); } .count.bad { background: var(--danger); }
.banner { margin: 16px 24px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 16px; border-radius: var(--r-btn); font-size: 0.875rem; }
.banner.bad { background: var(--tint-danger); border: 1px solid var(--danger); }
.banner.warn { background: var(--tint-warning); border: 1px solid var(--warning); }
.banner .actions { margin-left: auto; display: flex; gap: 8px; }
.toast { position: fixed; left: 24px; bottom: 24px; z-index: 10; max-width: 420px; padding: 12px 16px; border-radius: var(--r-btn); font-size: 0.875rem; box-shadow: 0 8px 24px rgb(0 0 0 / 0.4); }
.toast.ok { background: var(--tint-success); border: 1px solid var(--success); }
.toast.info { background: var(--tint-primary); border: 1px solid var(--navy); }
.toast.error { background: var(--tint-danger); border: 1px solid var(--danger); }
.main { width: 100%; max-width: 1440px; margin: 0 auto; padding: 20px 24px 40px; }
</style>
