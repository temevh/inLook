#!/usr/bin/env node
// Usage: node answers.js "your multi word task" [--mode fast] [--out result.json]
// Requires CONTEXT_API_KEY env variable. Node 18+ (global fetch).
const fs = require("fs");
const path = require("path");

// Load .env from the script's directory (process.loadEnvFile needs Node 20.12+/21.7+).
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {}

async function main() {
  const args = process.argv.slice(2);
  let mode = "fast";
  let out = "answers.json";
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode") mode = args[++i];
    else if (args[i] === "--out") out = args[++i];
    else words.push(args[i]);
  }
  const task = words.join(" ").trim();
  if (!task) {
    console.error(
      'Usage: node answers.js "your task text" [--mode fast] [--out file.json]',
    );
    process.exit(1);
  }
  const key = process.env.CONTEXT_API_KEY;
  if (!key) {
    console.error("CONTEXT_API_KEY environment variable is not set");
    process.exit(1);
  }

  const res = await fetch("https://api.context.dev/v1/web/answers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ task, mode }),
  });

  console.log(task);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`);
    console.error(text);
    process.exit(1);
  }

  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Saved response to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
