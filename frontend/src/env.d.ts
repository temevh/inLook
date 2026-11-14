/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/** True when the dev proxy's /mock target is not on this machine (e.g. Render), so it may need to wake up. */
declare const __INLOOK_MOCK_REMOTE__: boolean;

interface ImportMetaEnv {
  /** Person id of the signed-in employee until there is a real login, e.g. p-sam. */
  readonly VITE_INLOOK_USER?: string;
}
