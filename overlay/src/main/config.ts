export const config = {
  backendUrl: (process.env.INLOOK_BACKEND_URL ?? "https://inlook.onrender.com").replace(/\/$/, ""),
  /** Global "check now" hotkey. */
  checkHotkey: process.env.INLOOK_HOTKEY ?? "CommandOrControl+Alt+K",
  /** Screen edge the HUD strip docks to. */
  hudEdge: (process.env.INLOOK_HUD_EDGE === "left" ? "left" : "right") as "left" | "right",
  hudWidth: Number(process.env.INLOOK_HUD_WIDTH ?? 380),
};
