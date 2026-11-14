// X11 PRIMARY selection: highlighted text, no copy needed. Linux only.
// Electron 45 API: clipboard.selection.readText() (async). The spec's
// clipboard.readText("selection") is the pre-45 form.
import { clipboard } from "electron";

export async function readSelection(): Promise<string> {
  if (!clipboard.selection) return ""; // undefined off Linux
  return (await clipboard.selection.readText()).trim();
}
