// Shared shapes + motion for the Inlook video scenes (1920×1080 SVG stage).
const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("s");
const COL = { bg: "#0f1216", card: "#171b21", card2: "#1f252e", rule: "#2b313b", text: "#eceef1", muted: "#8f97a3", ok: "#5fd4b4", warn: "#f0b44c", bad: "#ff5d5d", web: "#7aa7ff" };

function mk(tag, a = {}, p = svg) { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; }
function txt(p, x, y, cls, s, extra = {}) { const e = mk("text", { x, y, class: cls, ...extra }, p); e.textContent = s; return e; }
const L = { links: mk("g"), pk: mk("g"), nodes: mk("g"), top: mk("g") };
function grp(x, y, p = L.nodes) { return mk("g", { transform: `translate(${x},${y})` }, p); }
const P = {};
function link(k, d, cls = "link") { return (P[k] = mk("path", { d, class: cls }, L.links)); }
const curve = (x1, y1, x2, y2) => { const m = (x1 + x2) / 2; return `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`; };
const vcurve = (x1, y1, x2, y2) => { const m = (y1 + y2) / 2; return `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`; };
const line = (x1, y1, x2, y2) => `M${x1},${y1} L${x2},${y2}`;

txt(L.top, 60, 84, "wordmark", "Inlook");
const caption = txt(L.top, 960, 1010, "caption", "", { "text-anchor": "middle" });
let TEMPO = 1; // per-scene speed multiplier
const wait = ms => new Promise(r => setTimeout(r, ms / TEMPO));
async function say(s) { caption.style.opacity = 0; await wait(350); caption.textContent = s; caption.style.opacity = 1; }
const flash = (el, cls = "ok", ms = 700) => { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
const show = (el, on = true) => el.classList.toggle("hide", !on);
const faded = el => { el.classList.add("fade", "hide"); return el; };
const ghost = (el, on = true) => el.classList.toggle("ghost", on);
async function loop(fn) { while (true) await fn(); }

// ── Shapes ────────────────────────────────────────────────
function speech(x, y, label) {
  const g = grp(x, y);
  const box = mk("path", { class: "box", d: "M18,0 H222 Q240,0 240,18 V72 Q240,90 222,90 H74 L44,116 L48,90 H18 Q0,90 0,72 V18 Q0,0 18,0 Z" }, g);
  txt(g, 26, 56, "t-l", label);
  return { g, box };
}
function chat(x, y, label) {
  const g = grp(x, y);
  mk("path", { class: "box", style: "opacity:.6", d: "M34,-18 H236 Q250,-18 250,-4 V50 Q250,64 236,64 H34 Q20,64 20,50 V-4 Q20,-18 34,-18 Z" }, g);
  const box = mk("path", { class: "box", d: "M14,0 H216 Q230,0 230,14 V76 Q230,90 216,90 H200 L208,112 L176,90 H14 Q0,90 0,76 V14 Q0,0 14,0 Z" }, g);
  txt(g, 24, 56, "t-l", label);
  return { g, box };
}
function doc(x, y, label) {
  const g = grp(x, y);
  const box = mk("path", { class: "box", d: "M0,0 H196 L240,44 V110 H0 Z" }, g);
  mk("path", { class: "detail", d: "M196,0 V44 H240 M26,76 H170 M26,92 H130" }, g);
  txt(g, 26, 52, "t-l", label);
  return { g, box };
}
function browser(x, y, w, h, url = "") {
  const g = grp(x, y);
  const box = mk("rect", { width: w, height: h, rx: 14, class: "box web" }, g);
  mk("path", { class: "detail", d: `M0,40 H${w}` }, g);
  [22, 44, 66].forEach(cx => mk("circle", { cx, cy: 20, r: 6, fill: COL.web, opacity: .6 }, g));
  if (url) txt(g, 90, 27, "t-m", url, { style: "font-size:17px" });
  return { g, box };
}
function core(x, y, w = 280, h = 240) {
  const g = grp(x, y);
  const box = mk("rect", { width: w, height: h, rx: 22, class: "box" }, g);
  txt(g, 30, 64, "t-xl", "Inlook");
  ["capture", "check", "remember"].forEach((s, i) => {
    mk("circle", { cx: 38, cy: 104 + i * 34, r: 5, fill: COL.ok }, g);
    txt(g, 56, 111 + i * 34, "t-m", s);
  });
  const st = txt(g, 30, h - 22, "t-m", "listening", { style: `fill:${COL.ok}; font-weight:600` });
  return { g, box, status: (s, c = COL.ok) => { st.textContent = s; st.style.fill = c; } };
}
function cylinder(x, y, w, h) {
  const g = grp(x, y), ry = Math.min(28, w * .12);
  const box = mk("path", { class: "box", d: `M0,${ry} A${w / 2},${ry} 0 0,1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0,1 0,${h - ry} Z` }, g);
  mk("path", { class: "detail", d: `M0,${ry} A${w / 2},${ry} 0 0,0 ${w},${ry}` }, g);
  return { g, box, ry };
}
function tag(x, y, label, val, src, w = 280, h = 116) {
  // Fact card: labelled header band, value, source line
  const g = grp(x, y);
  const box = mk("rect", { width: w, height: h, rx: 14, class: "box" }, g);
  mk("path", { d: `M1.5,15 Q1.5,1.5 15,1.5 H${w - 15} Q${w - 1.5},1.5 ${w - 1.5},15 V36 H1.5 Z`, fill: COL.card2 }, g);
  mk("circle", { cx: 20, cy: 19, r: 4, fill: COL.muted }, g);
  const l = txt(g, 34, 25, "t-col", label, { style: "font-size:13px" });
  const v = txt(g, 20, 76, "t-val", val, { style: "font-size:26px" });
  const s = txt(g, 20, 102, "t-m", src, { style: "font-size:16px" });
  return { g, box, l, v, s, set(label2, val2, src2) { l.textContent = label2; v.textContent = val2; s.textContent = src2; } };
}
function strategy(x, y, name, w = 260, h = 170, n = 3, labels = []) {
  // Strategy: a card resting on a foundation of fact blocks
  const g = grp(x, y), ch = h - 42;
  const box = mk("rect", { width: w, height: ch, rx: 16, class: "box" }, g);
  mk("path", { d: `M${w - 40},20 V48 M${w - 40},20 H${w - 20} L${w - 25},27 L${w - 20},34 H${w - 40}`, fill: "none", stroke: COL.muted, "stroke-width": 2.5, "stroke-linejoin": "round" }, g);
  txt(g, 22, ch / 2 - 2, "t-l", name, { style: "font-size:24px" });
  const st = txt(g, 22, ch / 2 + 30, "t-m", "healthy", { style: `fill:${COL.ok}; font-size:18px; font-weight:600` });
  const bw = (w - (n - 1) * 8) / n;
  const blocks = Array.from({ length: n }, (_, i) => mk("rect", { x: i * (bw + 8), y: ch + 10, width: bw, height: 32, rx: 8, class: "box", style: `fill:${COL.card2}` }, g));
  labels.forEach((t, i) => txt(g, i * (bw + 8) + bw / 2, ch + 31, "t-m", t, { "text-anchor": "middle", style: "font-size:13px; font-weight:600" }));
  return { g, box, blocks, set(s, c = COL.ok) { st.textContent = s; st.style.fill = c; } };
}
const house = strategy;
function person(x, y, name, p = L.nodes) {
  const g = mk("g", { class: "person", transform: `translate(${x},${y})` }, p);
  mk("circle", { cx: 0, cy: -12, r: 10 }, g);
  mk("path", { d: "M-17,16 Q-17,2 0,2 Q17,2 17,16 Z" }, g);
  if (name) txt(g, 28, 8, "", name);
  return g;
}
function team(x, y, w, h, name) {
  const g = grp(x, y);
  mk("rect", { width: w, height: h, rx: 18, class: "team" }, g);
  txt(g, 22, 38, "t-col", name);
  return g;
}
// A team as a row: a trunk line from `from` enters the row and runs along a corridor
// under the people; each person hangs off it. Per-person paths stay invisible until routed.
function teamRow(x, y, w, h, name, names, from, prefix, spacing = 240) {
  team(x, y, w, h, name);
  const busY = y + h - 24, py = y + h / 2 + 12, ppl = {};
  const pxs = names.map((_, j) => x + 90 + j * spacing);
  const trunk = curve(from[0], from[1], x, busY);
  mk("path", { d: trunk + ` H${pxs[pxs.length - 1]}`, class: "link" }, L.links);
  mk("path", { class: "detail", d: pxs.map(px => `M${px},${busY} V${py + 18}`).join(" ") }, L.links);
  names.forEach((n, j) => { const k = prefix + j; link(k, trunk + ` H${pxs[j]} V${py + 18}`, "link ghost"); ppl[k] = person(pxs[j], py, n); });
  return ppl;
}
const act = (k, cls) => P[k].setAttribute("class", `link ${cls}`);
const deact = k => P[k].setAttribute("class", "link ghost");

// Small 120×88 icons for pipelines
function icon(kind, x, y) {
  const g = grp(x, y); let box;
  if (kind === "bubble") box = mk("path", { class: "box", d: "M12,0 H108 Q120,0 120,12 V60 Q120,72 108,72 H40 L22,90 L26,72 H12 Q0,72 0,60 V12 Q0,0 12,0 Z" }, g);
  if (kind === "db") { box = mk("path", { class: "box", d: "M0,14 A60,14 0 0,1 120,14 V74 A60,14 0 0,1 0,74 Z" }, g); mk("path", { class: "detail", d: "M0,14 A60,14 0 0,0 120,14 M0,40 A60,14 0 0,0 120,40" }, g); }
  if (kind === "web") { box = mk("rect", { width: 120, height: 84, rx: 10, class: "box web" }, g); mk("path", { class: "detail", d: "M0,24 H120" }, g); [14, 28, 42].forEach(cx => mk("circle", { cx, cy: 12, r: 4, fill: COL.web, opacity: .6 }, g)); }
  if (kind === "tag") { box = mk("rect", { width: 120, height: 84, rx: 12, class: "box" }, g); mk("path", { d: "M1.5,13 Q1.5,1.5 13,1.5 H107 Q118.5,1.5 118.5,13 V26 H1.5 Z", fill: COL.card2 }, g); mk("path", { class: "detail", d: "M16,50 H90 M16,66 H64" }, g); }
  if (kind === "strategy") { box = mk("rect", { width: 120, height: 58, rx: 12, class: "box" }, g); [0, 1, 2].forEach(i => mk("rect", { x: i * 42, y: 66, width: 36, height: 22, rx: 6, class: "box", style: `fill:${COL.card2}` }, g)); }
  return { g, box };
}

// ── Motion ────────────────────────────────────────────────
const movers = [];
function travel(keys, color = COL.ok, speed = 9, r = 7) {
  return new Promise(res => {
    const segs = keys.map(k => { const rev = k[0] === "~"; const el = P[rev ? k.slice(1) : k]; return { el, rev, len: el.getTotalLength() }; });
    const el = mk("circle", { r, fill: color }, L.pk);
    movers.push({ segs, i: 0, d: 0, speed: speed * TEMPO, el, res });
  });
}
let _last = performance.now();
(function tick(now) {
  const dt = Math.min(50, (now || _last) - _last) / 16.67; _last = now || _last;
  for (let k = movers.length - 1; k >= 0; k--) {
    const m = movers[k];
    m.d += m.speed * dt;
    while (m.i < m.segs.length && m.d >= m.segs[m.i].len) { m.d -= m.segs[m.i].len; m.i++; }
    if (m.i >= m.segs.length) { m.el.remove(); movers.splice(k, 1); m.res(); continue; }
    const s = m.segs[m.i], p = s.el.getPointAtLength(s.rev ? s.len - m.d : m.d);
    m.el.setAttribute("cx", p.x); m.el.setAttribute("cy", p.y);
  }
  requestAnimationFrame(tick);
})();
