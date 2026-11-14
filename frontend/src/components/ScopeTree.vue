<script setup lang="ts">
import { computed, ref } from "vue";
import { useInlook } from "../stores/inlook";

const store = useInlook();
const showAll = ref(false);
/** Your managers up to the top: shown dimmed above you, so you see where you sit. */
const chain = computed(() => {
  const ids = new Set<string>();
  let p = store.viewer ? store.records.people[store.viewer.reportsTo ?? ""] : undefined;
  while (p && !ids.has(p.id)) { ids.add(p.id); p = store.records.people[p.reportsTo ?? ""]; }
  return ids;
});
const rows = computed(() => (showAll.value ? store.org : store.org.filter(({ person }) => store.scope.team.has(person.id) || chain.value.has(person.id))));
const hiddenCount = computed(() => store.org.length - rows.value.length);
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
</script>

<template>
  <section class="card scope" aria-labelledby="scope-h">
    <div class="head"><h2 id="scope-h">Your scope</h2></div>
    <ul>
      <li
        v-for="{ person, depth } in rows" :key="person.id"
        :style="{ paddingLeft: `${depth * 22}px` }"
        :class="{ out: !store.scope.team.has(person.id), me: person.id === store.viewer?.id }"
      >
        <span class="av" aria-hidden="true">{{ initials(person.name) }}</span>
        <span><strong>{{ person.name }}</strong><span class="muted role">{{ person.role }}</span></span>
        <span v-if="person.id === store.viewer?.id" class="tag you">You</span>
        <span v-else-if="chain.has(person.id)" class="tag">Above you</span>
        <span v-else-if="!store.scope.team.has(person.id)" class="tag">Not visible</span>
      </li>
    </ul>
    <button v-if="hiddenCount || showAll" class="btn ghost more" type="button" @click="showAll = !showAll">
      {{ showAll ? "Show only my part" : `Show whole company (${hiddenCount} more)` }}
    </button>
  </section>
</template>

<style scoped>
.scope { padding: 18px; display: flex; flex-direction: column; }
.more { align-self: flex-start; margin-top: 8px; }
.head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 10px; min-height: 40px; font-size: 0.8125rem; line-height: 1.3; }
li.out { opacity: 0.45; }
.role { display: block; font-size: 0.75rem; }
.av { flex: none; width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.6875rem; font-weight: 800; background: var(--navy-700); color: #e9effd; }
li.me .av { background: var(--brand); color: #fff; }
li.out .av { background: var(--quiet); }
.tag { margin-left: auto; border-radius: 999px; padding: 3px 10px; font-size: 0.75rem; font-weight: 600; background: var(--quiet); color: #fff; }
.tag.you { background: var(--navy); }
</style>
