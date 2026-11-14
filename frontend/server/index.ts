// Read-only API over the backend's MongoDB Atlas data, for the Vue dashboard.
// Prisma runs here (Node), never in the browser. The FastAPI backend stays the only writer.
import { createServer } from "node:http";
import { prisma } from "./db";

const PORT = Number(process.env.PORT ?? 3001);

const routes: Record<string, () => Promise<unknown>> = {
  "/api/health": async () => {
    await prisma.$runCommandRaw({ ping: 1 });
    return { ok: true };
  },
  "/api/facts": () => prisma.facts.findMany({ orderBy: { key: "asc" } }),
  "/api/strategies": () => prisma.strategies.findMany({ orderBy: { name: "asc" } }),
  "/api/people": () => prisma.people.findMany({ orderBy: { name: "asc" } }),
  "/api/reviews": () => prisma.reviews.findMany({ orderBy: { createdAt: "desc" } }),
  "/api/messages": () => prisma.messages.findMany({ orderBy: { at: "desc" } }),
  "/api/events": () => prisma.events.findMany({ orderBy: { seq: "desc" }, take: 200 }),
};

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const handler = req.method === "GET" ? routes[path] : undefined;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!handler) {
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    res.end(JSON.stringify(await handler()));
  } catch (err) {
    console.error(path, err);
    res.writeHead(503).end(JSON.stringify({ error: "database unavailable" }));
  }
}).listen(PORT, () => console.log(`inLook data API on http://localhost:${PORT}`));
