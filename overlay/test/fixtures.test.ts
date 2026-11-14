// Mock fixtures must satisfy shared/event.schema.json (same ajv setup as scripts/mock.mjs).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const ajv = new Ajv2020();
addFormats(ajv);
ajv.addSchema(readJson(join(root, "shared", "card.schema.json")), "card.schema.json");
const validate = ajv.compile(readJson(join(root, "shared", "event.schema.json")));

const envelope = (item: { type: string; payload: unknown }, seq: number) => ({
  seq, type: item.type, payload: item.payload, at: new Date().toISOString(),
});

const mockDir = join(root, "overlay", "mock");
const files = readdirSync(mockDir).filter((n) => n.endsWith(".json"));

describe("mock fixtures", () => {
  it("finds fixtures", () => expect(files.length).toBeGreaterThan(0));

  for (const file of files) {
    it(`${file}: every item validates`, () => {
      const items = readJson(join(mockDir, file));
      items.forEach((item: { type: string; payload: unknown }, i: number) => {
        const ok = validate(envelope(item, i + 1));
        expect(ok, `item ${i} (${item.type}): ${ajv.errorsText(validate.errors)}`).toBe(true);
      });
    });
  }

  const verdict = readJson(join(mockDir, "demo.json")).find((i: { type: string }) => i.type === "claim.verdict");

  it("rejects a bad criticality", () => {
    const bad = structuredClone(verdict);
    bad.payload.card.criticality = "urgent";
    expect(validate(envelope(bad, 1))).toBe(false);
  });

  it("rejects a missing payload field", () => {
    const bad = structuredClone(verdict);
    delete bad.payload.claimId;
    expect(validate(envelope(bad, 1))).toBe(false);
  });
});
