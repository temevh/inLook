// Bridge exposed as window.inlook. Sandboxed preload: only "electron" may be
// required at runtime, so local imports are type-only.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { InlookBridge, IpcInvoke, IpcPush } from "../shared/ipc";

const invoke = (channel: IpcInvoke, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const listen = <T>(channel: IpcPush, cb: (v: T) => void) => {
  const fn = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => { ipcRenderer.off(channel, fn); };
};

const bridge: InlookBridge = {
  checkSelection: () => invoke("check:selection"),
  checkScreen: () => invoke("check:screen"),
  setHudInteractive: (on) => invoke("hud:set-interactive", on),
  setTranscribing: (on) => invoke("mic:set-transcribing", on),
  sendAudioFrame: (pcm) => invoke("audio:frame", pcm) as Promise<void>,
  decideReview: (id, decision) => invoke("review:decide", id, decision),
  getState: () => invoke("state:get"),
  onEvent: (cb) => listen("inlook:event", cb),
  onState: (cb) => listen("inlook:state", cb),
};

contextBridge.exposeInMainWorld("inlook", bridge);
