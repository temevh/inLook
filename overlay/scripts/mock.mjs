// Mock backend driver: POSTs a scenario to the backend's /dev/events, which validates
// each event against the contract (422 on a bad one).
// Usage: npm run mock [scenario]   (overlay/mock/<scenario>.json, default "demo")
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scenario = process.argv[2] ?? 'demo';
const base = process.env.INLOOK_BACKEND_URL ?? 'http://127.0.0.1:8000';
const items = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'mock', `${scenario}.json`), 'utf8'));

for (const [i, item] of items.entries()) {
  await new Promise((r) => setTimeout(r, item.delayMs));
  const res = await fetch(`${base}/dev/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: item.type, payload: item.payload }),
  });
  if (!res.ok) {
    console.error(`item ${i} (${item.type}): HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`sent ${i + 1}/${items.length} ${item.type}`);
}
