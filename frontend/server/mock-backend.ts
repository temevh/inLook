// MOCK backend for demo mode. It is NOT the FastAPI service in backend/: it answers the same endpoints
// (shared/CONTRACT.md, backend/README.md) from the mock data in src/mock/demo-data.json, runs claims
// through the same demo engine the dashboard uses (src/data/demo.ts), and prints every request and the
// steps the real backend would take (Gemini, Context.dev, MongoDB writes, SSE publishes) to this terminal.
// Nothing leaves this process: no database, no Gemini, no Context.dev.
//
// Run: npm run mock   (port 8787, or MOCK_PORT). The dashboard reaches it through the Vite proxy at /mock/*.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decide, matchFact, routeClaim, type DemoClaim, type Step } from "../src/data/demo";
import { applyEvent } from "../src/lib/fold";
import { effectiveTier } from "../src/lib/scope";
import { MEETING } from "../src/mock/script";
import { demoSnapshot } from "../src/mock/seed";
import type { InlookEvent, Records } from "../src/types";

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- terminal output ----------
const tty = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: paint("2"), bold: paint("1"), red: paint("31"), green: paint("32"), yellow: paint("33"),
  blue: paint("34"), magenta: paint("35"), cyan: paint("36"), grey: paint("90"),
};
const clock = () => new Date().toTimeString().slice(0, 8);
const PAD = " ".repeat(10);
const out = (s: string) => process.stdout.write(`${s}\n`);
/** One "performed" step under a request: what the real backend would do at this point. */
function act(tag: string, service: string, text: string) {
  const colour = service.startsWith("gemini") ? c.magenta : service.startsWith("context") ? c.cyan
    : service.startsWith("sse") ? c.blue : service.startsWith("route") ? c.yellow : c.green;
  out(`${PAD}${c.grey(`[${tag}]`.padEnd(20))} ${colour(service.padEnd(15))} ${text}`);
}
const statusColour = (n: number) => (n < 300 ? c.green : n < 500 ? c.yellow : c.red)(String(n));
const short = (v: unknown, max = 140) => { const s = JSON.stringify(v); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

// ---------- state ----------
let records: Records;
let events: InlookEvent[];
let bootId: string;
let checks = 0;
const clients = new Set<ServerResponse>();

function reseed() {
  const s = demoSnapshot();
  const { events: ev, ...r } = s;
  records = r;
  events = [...ev].sort((a, b) => a.seq - b.seq);
  bootId = randomBytes(4).toString("hex");
}
reseed();

const name = (id: string) => records.people[id]?.name ?? id;
const who = (req: IncomingMessage) => {
  const id = String(req.headers["x-inlook-user"] ?? "");
  return records.people[id] ? id : null;
};

// ---------- event log + SSE (backend app/events.py) ----------
function frame(e: InlookEvent) { return `id: ${bootId}:${e.seq}\ndata: ${JSON.stringify(e)}\n\n`; }

function publish(tag: string, type: InlookEvent["type"], payload: InlookEvent["payload"]) {
  const e = { seq: (events.at(-1)?.seq ?? 0) + 1, type, payload, at: new Date().toISOString() } as InlookEvent;
  applyEvent(records, e);
  events.push(e);
  for (const res of clients) res.write(frame(e));
  act(tag, "sse.publish", `${c.bold(`#${e.seq}`)} ${type} ${c.dim(`→ ${clients.size} client${clients.size === 1 ? "" : "s"}`)}`);
}

/** Describes a step the way the backend's pipeline would perform it, then publishes its event. */
function narrate(tag: string, s: Step) {
  const p = s.payload as Record<string, any>;
  const fact = p.factId ? records.facts[p.factId] : undefined;
  switch (s.type) {
    case "claim.spotted":
      act(tag, p.source === "page" ? "context.dev" : "gemini.spot", p.source === "page"
        ? `re-check requested, no spoken claim: ${c.bold(fact?.label ?? String(p.text).replace(/^Re-check: /, ""))}`
        : `claim found in ${p.source}${p.lineId ? ` (${p.lineId})` : ""}: "${p.text}"`);
      break;
    case "claim.unverified":
      act(tag, "gemini.match", c.yellow("no stored fact matches this claim (reason: no_match)"));
      break;
    case "claim.verdict": {
      if (fact) act(tag, "gemini.match", `→ ${fact.id} "${fact.label}" (stored: ${fact.value}, tier ${fact.tier})`);
      act(tag, "context.dev", fact?.sourceUrl ? `scrape ${c.dim(fact.sourceUrl)}` : "no source page: Context.dev search");
      const v = p.verdict === "outdated" ? c.red("outdated") : p.verdict === "current" ? c.green("current") : c.yellow("unverifiable");
      act(tag, "gemini.verdict", `${v}${p.newValue ? `: ${p.oldValue} → ${p.newValue}` : ""} · card "${p.card.title}", criticality ${p.card.criticality}`);
      if (p.verdict === "outdated" && fact) {
        const tier = effectiveTier(fact.id, fact.tier, records.strategies);
        const pending = Object.values(records.reviews).some((r) => r.factId === fact.id && r.status === "pending");
        const raised = tier !== fact.tier ? ` (stored ${fact.tier}, raised: a strategy relies on it)` : "";
        act(tag, "route", pending ? "a review is already open for this fact: nobody is asked again"
          : tier === "low" ? `tier low${raised} → save the new version at once`
          : tier === "medium" ? `tier medium${raised} → review by ${name(fact.statedBy)}, who stated it`
          : `tier high → review by the owners of every relying strategy, flag them, message the owners`);
      }
      break;
    }
    case "fact.updated":
      act(tag, "db.facts", `${fact?.label ?? p.factId}: append version "${p.version.value}" by ${p.version.by === "inlook" ? "inlook (automatic)" : name(p.version.by)}, status current`);
      break;
    case "review.created":
      act(tag, "db.reviews", `insert ${p.reviewId} (${p.tier}) for ${p.reviewers.map((x: { name: string }) => x.name).join(", ")}`);
      act(tag, "db.facts", `${fact?.label ?? p.factId}: status pending_review`);
      break;
    case "strategy.flagged":
      act(tag, "db.strategies", `${p.name}: status ${c.red("flagged")}`);
      break;
    case "message.created":
      act(tag, "db.messages", `to ${p.to.map((x: { name: string }) => x.name).join(", ")}: "${p.text}"`);
      break;
    case "review.closed":
      act(tag, "db.reviews", `${p.reviewId}: pending → ${p.status === "accepted" ? c.green("accepted") : c.yellow("rejected")}`);
      break;
    case "strategy.healthy":
      act(tag, "db.strategies", `${p.name}: status ${c.green("healthy")} (none of its facts is pending)`);
      break;
  }
  publish(tag, s.type, s.payload);
}

/** Plays a pipeline's steps with their delays, like the backend's background task. */
async function run(tag: string, steps: Step[]) {
  for (const s of steps) {
    await sleep(s.delayMs);
    narrate(tag, s);
  }
  act(tag, "done", c.dim(`${steps.length} event${steps.length === 1 ? "" : "s"} published`));
}

// ---------- HTTP ----------
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return undefined; }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  return { status, data };
}

/** The request line, who sent it and its body. */
function header(req: IncomingMessage, path: string, b?: unknown) {
  const by = path.startsWith("/dev/") ? null : who(req); // dev calls stand in for services, not a person
  out(`${c.grey(clock())}  ${c.bold(req.method ?? "")} ${c.bold(path)}${by ? c.dim(`  as ${name(by)} (${records.people[by].role})`) : ""}`);
  if (b !== undefined && Object.keys(b as object).length) out(`${PAD}${c.grey("body".padEnd(20))} ${c.dim(short(b, 120))}`);
}
const reply = (status: number, data: unknown) => out(`${PAD}${c.grey("→ response".padEnd(20))} ${statusColour(status)} ${c.dim(short(data, 120))}`);

const API: Record<string, () => unknown> = {
  "/api/people": () => Object.values(records.people),
  "/api/facts": () => Object.values(records.facts),
  "/api/strategies": () => Object.values(records.strategies),
  "/api/reviews": () => Object.values(records.reviews),
  "/api/messages": () => Object.values(records.messages),
  "/api/events": () => [...events].reverse().slice(0, 200),
};

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // Reads: the Prisma data API (server/index.ts) and /health. One dim line each.
  if (method === "GET" && API[path]) {
    const rows = API[path]() as unknown[];
    out(`${c.grey(clock())}  ${c.dim(`GET ${path}  200 · ${rows.length} rows (data API)`)}`);
    return send(res, 200, rows);
  }
  if (method === "GET" && path === "/health") {
    out(`${c.grey(clock())}  ${c.dim("GET /health  200")}`);
    return send(res, 200, { ok: true, database: "mock", events: "memory", mock: true });
  }

  if (method === "GET" && path === "/stream") {
    const last = String(req.headers["last-event-id"] ?? "");
    const [b, n] = last.split(":");
    const from = b === bootId && Number.isFinite(Number(n)) ? Number(n) : 0;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": connected\n\n");
    const replay = events.filter((e) => e.seq > from);
    replay.forEach((e) => res.write(frame(e)));
    clients.add(res);
    out(`${c.grey(clock())}  ${c.bold("GET /stream")}  ${c.blue("SSE client connected")} ${c.dim(`· boot ${bootId} · replayed ${replay.length} event${replay.length === 1 ? "" : "s"}${last ? ` after ${last}` : ""} · ${clients.size} open`)}`);
    const ping = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
      out(`${c.grey(clock())}  ${c.dim(`SSE client disconnected · ${clients.size} open`)}`);
    });
    return;
  }

  if (method !== "POST") { header(req, path); reply(404, { detail: "Not Found" }); return send(res, 404, { detail: "Not Found" }); }

  const b = await body(req);
  header(req, path, b);
  if (b === undefined) { reply(400, { detail: "invalid JSON" }); return send(res, 400, { detail: "invalid JSON" }); }

  // POST /check: selection text or a single claim. 202 at once, the flow runs in the background.
  if (path === "/check") {
    if (b.kind !== "text" || typeof b.text !== "string" || !b.text.trim()) {
      const r = { detail: "body must be {kind: \"text\", text, source}" };
      reply(422, r); return send(res, 422, r);
    }
    const checkId = `chk-${++checks}`;
    const r = send(res, 202, { accepted: true, checkId });
    reply(r.status, r.data);
    const claim: DemoClaim = { text: b.text.trim(), source: "selection", factId: matchFact(b.text, records) };
    void run(checkId, routeClaim(records, claim, new Date().toISOString()));
    return;
  }

  // POST /recheck {factId}: Context.dev scrape of the fact's page, then tier routing like any claim.
  if (path === "/recheck") {
    if (!b.factId === !b.url) { const r = { detail: "give exactly one of factId or url" }; reply(422, r); return send(res, 422, r); }
    const facts = b.factId ? [records.facts[b.factId]].filter(Boolean) : Object.values(records.facts).filter((f) => f.sourceUrl === b.url);
    if (!facts.length) { const r = { detail: b.factId ? "unknown fact" : "no fact uses that url" }; reply(404, r); return send(res, 404, r); }
    const r = send(res, 202, { accepted: true, facts: facts.length });
    reply(r.status, r.data);
    for (const f of facts) {
      const tag = `chk-${++checks}`;
      void run(tag, routeClaim(records, { text: `Re-check: ${f.label}`, source: "page", factId: f.id }, new Date().toISOString()));
    }
    return;
  }

  // POST /reviews/{id}: accept or reject. 404 unknown, 409 already closed.
  const m = path.match(/^\/reviews\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const review = records.reviews[id];
    if (b.decision !== "accept" && b.decision !== "reject") { const r = { detail: "decision must be accept or reject" }; reply(422, r); return send(res, 422, r); }
    if (!review) { const r = { detail: "unknown review" }; reply(404, r); return send(res, 404, r); }
    if (review.status !== "pending") { const r = { detail: "review already closed" }; reply(409, r); return send(res, 409, r); }
    const by = who(req) ?? "reviewer";
    review.closedBy = by;
    const tag = id;
    const steps = decide(records, review, b.decision, new Date().toISOString(), by);
    // The real endpoint does its writes before it answers, so publish first (without the demo delays), then reply.
    for (const s of steps) narrate(tag, s);
    const r = send(res, 200, { id, status: b.decision === "accept" ? "accepted" : "rejected" });
    reply(r.status, r.data);
    return;
  }

  // POST /dev/events: inject an event (the backend only offers this with INLOOK_DEV=1). The demo's
  // meeting sends transcript lines here, standing in for the ElevenLabs relay behind WS /audio/stream.
  if (path === "/dev/events") {
    if (b.type !== "transcript.line" || !b.payload?.text) {
      const r = { detail: "the mock only accepts transcript.line here" }; reply(422, r); return send(res, 422, r);
    }
    const tag = b.payload.lineId ?? "line";
    act(tag, "elevenlabs", `${b.payload.speaker}: "${b.payload.text}"`);
    publish(tag, "transcript.line", b.payload);
    const r = send(res, 201, { accepted: true, seq: events.at(-1)!.seq });
    reply(r.status, r.data);
    // Spot claims in the line. The real backend asks Gemini; the mock knows the scripted meeting.
    const line = MEETING.find((x) => x.line === b.payload.text);
    if (!line?.claim) { act(tag, "gemini.spot", c.dim("no checkable claim in this line")); return; }
    await sleep(700);
    void run(tag, routeClaim(records, { ...line.claim, source: line.claim.source ?? "audio", lineId: b.payload.lineId }, new Date().toISOString()));
    return;
  }

  // POST /dev/reset: the mock's `python -m app.seed` plus a restart. A new boot id makes every
  // dashboard reload its snapshot.
  if (path === "/dev/reset") {
    reseed();
    act("reset", "db.seed", `reloaded demo-data.json · ${events.length} history events · new boot ${bootId}`);
    for (const res2 of clients) res2.end();
    clients.clear();
    const r = send(res, 200, { ok: true, bootId });
    reply(r.status, r.data);
    return;
  }

  reply(404, { detail: "Not Found" });
  return send(res, 404, { detail: "Not Found" });
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    out(c.red(`${PAD}error: ${(err as Error).stack ?? err}`));
    if (!res.headersSent) send(res, 500, { detail: "mock backend error" });
  });
}).listen(PORT, () => {
  const f = Object.values(records.facts);
  out("");
  out(`  ${c.bold("inLook backend")} ${c.yellow("· MOCK")}  ${c.dim("stand-in for backend/ (FastAPI). All data is mock data from src/mock/demo-data.json.")}`);
  out(`  ${c.dim("listening on")} http://localhost:${PORT}   ${c.dim("boot")} ${bootId}`);
  out(`  ${c.dim("records")}      ${Object.keys(records.people).length} people · ${f.length} facts · ${Object.keys(records.strategies).length} strategies · ${events.length} history events`);
  out(`  ${c.dim("endpoints")}    GET /stream · POST /check · POST /recheck · POST /reviews/{id} · GET /health`);
  out(`               GET /api/{people,facts,strategies,reviews,messages,events} · POST /dev/events · POST /dev/reset`);
  out(`  ${c.dim("services")}     Gemini, Context.dev, ElevenLabs and MongoDB are simulated; nothing leaves this process.`);
  out("");
});
