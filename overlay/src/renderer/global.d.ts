import type { InlookBridge } from "../shared/ipc";
declare global { interface Window { inlook: InlookBridge } }
export {};
