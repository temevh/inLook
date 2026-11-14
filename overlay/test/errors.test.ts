// Error-message mapping: the short texts the widget and the HUD retry line show.
// Runs the compiled dist/main code (see `pretest`).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { httpErrorMessage } from "../dist/main/errors.js";

describe("httpErrorMessage", () => {
  it("maps 501 to 'Not available yet'", () => expect(httpErrorMessage(501)).toBe("Not available yet"));
  it("maps other codes to 'Backend error (<code>)'", () => {
    expect(httpErrorMessage(500)).toBe("Backend error (500)");
    expect(httpErrorMessage(422)).toBe("Backend error (422)");
  });
});

describe("backend client errors", () => {
  let server: Server;
  let backend: typeof import("../dist/main/backend-client.js").backend;

  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    server = createServer((req, res) => {
      const code = req.url?.includes("/reviews/") ? 501 : 500;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "raw internal detail" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    // config reads the URL once, at first import
    process.env.INLOOK_BACKEND_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    backend = (await import("../dist/main/backend-client.js")).backend;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it("501 → Not available yet, no raw body", async () => {
    await expect(backend.postReview("r1", "accept")).rejects.toThrow(/^Not available yet$/);
  });
  it("other HTTP codes → Backend error (<code>)", async () => {
    await expect(backend.postCheck({ kind: "text", text: "x", source: "selection" })).rejects.toThrow(/^Backend error \(500\)$/);
  });
  it("unreachable backend → Backend offline", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    try {
      await expect(backend.postCheck({ kind: "text", text: "x", source: "selection" })).rejects.toThrow(/^Backend offline$/);
    } finally { vi.unstubAllGlobals(); }
  });
});
