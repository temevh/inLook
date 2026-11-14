// Mock fixtures must satisfy shared/event.schema.json. Uses the overlay's own validator
// from dist/main (built by `pretest`), the same check every live event goes through.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvent } from "../dist/main/validate.js";

const mockDir = join(__dirname, "..", "mock");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const files = readdirSync(mockDir).filter((n) => n.endsWith(".json"));

const envelope = (item: { type: string; payload: unknown }, seq: number) => ({
  seq, type: item.type, payload: item.payload, at: new Date().toISOString(),
});

describe("mock fixtures", () => {
  it("finds fixtures", () => expect(files.length).toBeGreaterThan(0));

  for (const file of files) {
    it(`${file}: every item validates`, () => {
      readJson(join(mockDir, file)).forEach((item: { type: string; payload: unknown }, i: number) => {
        expect(validateEvent(envelope(item, i + 1)), `item ${i} (${item.type})`).toBeNull();
      });
    });
  }

  const verdict = readJson(join(mockDir, "demo.json")).find((i: { type: string }) => i.type === "claim.verdict");

  it("accepts null for optional claim.verdict fields", () => {
    const ok = structuredClone(verdict);
    ok.payload.newValue = null;
    ok.payload.sourceUrl = null;
    expect(validateEvent(envelope(ok, 1))).toBeNull();
  });

  it("rejects a bad criticality", () => {
    const bad = structuredClone(verdict);
    bad.payload.card.criticality = "urgent";
    expect(validateEvent(envelope(bad, 1))).not.toBeNull();
  });

  it("rejects a missing payload field", () => {
    const bad = structuredClone(verdict);
    delete bad.payload.claimId;
    expect(validateEvent(envelope(bad, 1))).not.toBeNull();
  });
});
