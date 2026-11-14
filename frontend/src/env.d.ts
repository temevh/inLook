/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  /** Person id of the signed-in employee until there is a real login, e.g. p-sam. */
  readonly VITE_INLOOK_USER?: string;
}
