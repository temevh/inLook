// Copies renderer HTML/CSS into dist/web/ (tsc only emits JS).
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const src = join(dir, name);
    if (statSync(src).isDirectory()) { walk(src); continue; }
    if (![".html", ".css"].includes(extname(name))) continue;
    const dest = src.replace(/^src/, "dist/web");
    mkdirSync(join(dest, ".."), { recursive: true });
    cpSync(src, dest);
  }
};
walk("src/renderer");
