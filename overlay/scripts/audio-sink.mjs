// Dev-only: stands in for the backend's POST /audio. Saves each chunk to a temp
// dir and answers 202. Usage: node scripts/audio-sink.mjs [port]
// Then run the overlay with INLOOK_BACKEND_URL=http://127.0.0.1:<port>.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = Number(process.argv[2] ?? 8000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inlook-audio-"));
console.log(`saving chunks to ${dir}`);

http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/audio") {
    res.writeHead(404).end();
    return;
  }
  try {
    const form = await new Request("http://sink/audio", {
      method: "POST", headers: req.headers, body: req, duplex: "half",
    }).formData();
    const chunk = form.get("chunk");
    const file = path.join(dir, `chunk-${form.get("seqNo")}.webm`);
    fs.writeFileSync(file, Buffer.from(await chunk.arrayBuffer()));
    console.log(`seqNo=${form.get("seqNo")} startedAt=${form.get("startedAt")} type=${chunk.type} ${chunk.size} B → ${file}`);
    res.writeHead(202, { "content-type": "application/json" }).end('{"accepted":true}');
  } catch (err) {
    console.error(err);
    res.writeHead(400).end();
  }
}).listen(port, "127.0.0.1");
