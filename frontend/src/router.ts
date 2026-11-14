import { createRouter, createWebHistory } from "vue-router";
import ActivityView from "./views/ActivityView.vue";
import DeskView from "./views/DeskView.vue";
import FactsView from "./views/FactsView.vue";
import MeetingsView from "./views/MeetingsView.vue";
import StrategiesView from "./views/StrategiesView.vue";

/** Height of the sticky header and tabs, so a scrolled-to element is not hidden under them. */
const stickyHeight = () => document.querySelector<HTMLElement>(".top")?.offsetHeight ?? 0;

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "desk", component: DeskView },
    { path: "/facts/:id?", name: "facts", component: FactsView },
    { path: "/meetings", name: "meetings", component: MeetingsView },
    { path: "/strategies", name: "strategies", component: StrategiesView },
    { path: "/activity", name: "activity", component: ActivityView },
  ],
  // Notification actions link to "/#review-…" or "/strategies#strategy-…": scroll the target into view.
  scrollBehavior(to) {
    if (to.hash) return new Promise((resolve) => setTimeout(() => resolve({ el: to.hash, top: stickyHeight() + 16, behavior: "smooth" }), 50));
    return { top: 0 };
  },
});
