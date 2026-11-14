// Copies renderer HTML/CSS/fonts into dist/web/ and the shared JSON schemas into
// dist/schemas/ (tsc only emits JS).
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const src = join(dir, name);
    if (statSync(src).isDirectory()) { walk(src); continue; }
    if (![".html", ".css", ".woff2"].includes(extname(name))) continue;
    const dest = src.replace(/^src/, "dist/web");
    mkdirSync(join(dest, ".."), { recursive: true });
    cpSync(src, dest);
  }
};
walk("src/renderer");

mkdirSync("dist/schemas", { recursive: true });
for (const name of readdirSync("../shared").filter((n) => n.endsWith(".schema.json"))) {
  cpSync(join("../shared", name), join("dist/schemas", name));
}
