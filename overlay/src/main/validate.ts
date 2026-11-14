// Validates SSE events against shared/event.schema.json (+ card.schema.json).
// copy-static.mjs puts the schemas in dist/schemas/.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

const load = (name: string) => JSON.parse(readFileSync(join(__dirname, "../schemas", name), "utf8"));

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
ajv.addSchema(load("card.schema.json"), "card.schema.json"); // it has no $id; event.schema.json refs it by file name
const check = ajv.compile(load("event.schema.json"));

/** Returns an error text, or null when the event is valid. */
export function validateEvent(e: unknown): string | null {
  return check(e) ? null : ajv.errorsText(check.errors);
}
