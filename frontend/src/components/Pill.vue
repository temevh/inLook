<script setup lang="ts">
import type { Tone } from "../lib/labels";
defineProps<{ tone: Tone }>();
</script>

<template>
  <span class="pill" :class="tone"><slot /></span>
</template>

<style scoped>
/* Solid pills with white text: the PRODUCT.md status colours are too dark to read as text on the dark page. */
.pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 3px 10px; font-size: 0.75rem; font-weight: 600; color: #fff; white-space: nowrap; }
.ok { background: var(--success); }
.warn { background: var(--warning); }
.bad { background: var(--danger); }
.low { background: var(--navy); }
.quiet { background: var(--quiet); }
.primary { background: var(--brand); }
</style>
