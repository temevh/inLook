export const config = {
  backendUrl: (process.env.INLOOK_BACKEND_URL ?? "https://inlook.onrender.com").replace(/\/$/, ""),
  /** Global "check now" hotkey. */
  checkHotkey: process.env.INLOOK_HOTKEY ?? "CommandOrControl+Alt+K",
  /** Global hotkeys that accept / reject the newest pending review in the HUD. */
  acceptHotkey: process.env.INLOOK_ACCEPT_HOTKEY ?? "CommandOrControl+Alt+A",
  rejectHotkey: process.env.INLOOK_REJECT_HOTKEY ?? "CommandOrControl+Alt+R",
  /** Screen edge the HUD strip docks to. */
  hudEdge: (process.env.INLOOK_HUD_EDGE === "left" ? "left" : "right") as "left" | "right",
  hudWidth: Number(process.env.INLOOK_HUD_WIDTH ?? 380),
};
