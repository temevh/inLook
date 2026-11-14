// Mock backend driver: validates fixtures against shared/*.schema.json, then POSTs them to /dev/events.
// Usage: npm run mock [scenario]   (overlay/mock/<scenario>.json, default "demo")
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = join(import.meta.dirname, '..', '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const scenario = process.argv[2] ?? 'demo';
const base = process.env.INLOOK_BACKEND_URL ?? 'http://127.0.0.1:8000';

const items = readJson(join(root, 'overlay', 'mock', `${scenario}.json`));
const ajv = new Ajv2020();
addFormats(ajv);
ajv.addSchema(readJson(join(root, 'shared', 'card.schema.json')), 'card.schema.json');
const validate = ajv.compile(readJson(join(root, 'shared', 'event.schema.json')));

// The backend adds seq and at; fill them only for validation.
items.forEach((item, i) => {
  const event = { seq: i + 1, type: item.type, payload: item.payload, at: new Date().toISOString() };
  if (!validate(event)) {
    console.error(`${scenario}.json item ${i} (${item.type}) is invalid:`);
    console.error(ajv.errorsText(validate.errors, { separator: '\n' }));
    process.exit(1);
  }
});
console.log(`${items.length} items valid, sending to ${base}/dev/events`);

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
