// HUD logic without DOM: which card to evict when space runs out, and how card text, status and keys are worded.

/** Importance of a card; lower goes first. `null` = never evicted (pending review). */
export type Rank = number | null;

export interface CardInfo { tier?: string; kind: "claim" | "review" | "strategy" | "message" | "other"; resolved?: boolean; unverified?: boolean }

export function rankOf(c: CardInfo): Rank {
  if (c.kind === "review" && !c.resolved) return null; // waits for a decision
  if (c.kind === "strategy" || c.kind === "message") return 4; // flagged strategies and messages stay until resolved
  if (c.unverified || c.tier === undefined || c.tier === "low") return 1;
  return c.tier === "medium" ? 2 : 3;
}

/** Index of the card to drop, or -1. `ranks` is in stack order (0 = newest, which is never dropped).
 *  Lowest rank first, the oldest (highest index) among equals. */
export function evictionTarget(ranks: Rank[]): number {
  let best = -1;
  for (let i = ranks.length - 1; i >= 1; i--) {
    const r = ranks[i];
    if (r == null) continue;
    if (best < 0 || r < (ranks[best] as number)) best = i;
  }
  return best;
}

/** "Label: old → new" (the card text the backend writes for a change) → its parts, or null for any other text.
 *  Splits at the last " → " and the last ": " before it, so a label or value with a colon still works. */
export function splitChange(text: string): { label: string; old: string; new: string } | null {
  const arrow = text.lastIndexOf(" → ");
  const colon = arrow < 0 ? -1 : text.lastIndexOf(": ", arrow);
  if (colon < 0) return null;
  const parts = { label: text.slice(0, colon), old: text.slice(colon + 2, arrow), new: text.slice(arrow + 3) };
  return parts.label && parts.old && parts.new ? parts : null;
}

/** Two values that end in the same words share them as a unit, so the change reads "$8 → $10 · per seat per month".
 *  Only when one token is left on each side: "30 days" → "14 calendar days" stays whole. */
export function compactChange(oldValue: string, newValue: string): { old: string; new: string; unit: string } {
  const a = oldValue.trim().split(/\s+/), b = newValue.trim().split(/\s+/);
  let n = 0;
  while (n < a.length - 1 && n < b.length - 1 && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  const same = oldValue.trim() === newValue.trim(); // nothing changed: no unit to factor out
  if (same || n === 0 || a.length - n !== 1 || b.length - n !== 1) return { old: oldValue.trim(), new: newValue.trim(), unit: "" };
  return { old: a[0]!, new: b[0]!, unit: a.slice(a.length - n).join(" ") };
}

/** "$10" → { prefix: "$", value: 10, decimals: 0, suffix: "" }; null when the text is not one number with affixes. */
export function numberParts(text: string): { prefix: string; value: number; decimals: number; suffix: string } | null {
  const m = /^(\D*?)(\d+)(?:\.(\d+))?(\D*)$/.exec(text.trim());
  if (!m) return null;
  return { prefix: m[1]!, value: Number(`${m[2]}.${m[3] ?? "0"}`), decimals: m[3]?.length ?? 0, suffix: m[4]! };
}

/** Frame `t` (0..1) of a number rolling from one value to another, when both look alike ("$8" → "$10"); else null. */
export function rollFrame(from: string, to: string, t: number): string | null {
  const a = numberParts(from), b = numberParts(to);
  if (!a || !b || a.prefix !== b.prefix || a.suffix !== b.suffix) return null;
  const v = a.value + (b.value - a.value) * Math.max(0, Math.min(1, t));
  return `${b.prefix}${v.toFixed(Math.max(a.decimals, b.decimals))}${b.suffix}`;
}

export type StatusTone = "listening" | "live" | "wait" | "off";
/** What the header says, in the user's words, from the connection and mic state. */
export function statusOf(s: { stream: string; transcribing: boolean; audio: string }): { text: string; tone: StatusTone } {
  if (s.stream === "closed") return { text: "Offline", tone: "off" };
  if (s.stream !== "open") return { text: "Connecting…", tone: "wait" };
  if (!s.transcribing) return { text: "Live", tone: "live" };
  if (s.audio === "live") return { text: "Listening", tone: "listening" };
  return { text: s.audio === "reconnecting" ? "Mic reconnecting…" : "Mic connecting…", tone: "wait" };
}

/** A transcript line with nothing to read ("Uh", "Yes."): fewer than two words and no number. */
export function isFiller(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length < 2 && !/\d/.test(text);
}

/** "https://www.notion.com/pricing" → "notion.com"; "" for anything that is not a URL. */
export function domainOf(url: string | null | undefined): string {
  try { return new URL(url ?? "").hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** "Ada Mockridge" → "AM" (first and last word). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return ((words[0]![0] ?? "") + (words.length > 1 ? words[words.length - 1]![0] ?? "" : "")).toUpperCase();
}

/** Electron accelerator → keycap labels: "CommandOrControl+Alt+A" → ["Ctrl", "Alt", "A"]. */
export function keycaps(accelerator: string): string[] {
  const names: Record<string, string> = { CommandOrControl: "Ctrl", CmdOrCtrl: "Ctrl", Control: "Ctrl", Command: "Cmd", Super: "Super" };
  return accelerator.split("+").filter(Boolean).map((k) => names[k] ?? k);
}

/** The fact's name from a card line: "Label: old → new" → "Label"; "Label: value (still current)" → "Label";
 *  anything else is returned as it is. */
export function factLabel(text: string, value?: string): string {
  const change = splitChange(text);
  if (change) return change.label;
  const at = value ? text.indexOf(`: ${value}`) : -1;
  return at > 0 ? text.slice(0, at) : text;
}
