/// <reference types="vite/client" />

declare const __APP_CODE__: string;

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_CODE: string;
  readonly VITE_HTTP_PROXY?: string;
  readonly VITE_LOGTO_ENDPOINT: string;
  readonly VITE_LOGTO_APP_ID: string;
  readonly VITE_LOGTO_API_RESOURCE: string;
  readonly VITE_PLATFORM_ID: string;
  readonly VITE_PAYPAL_API_BASE?: string;
  readonly VITE_PAYPAL_OAUTH_START?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
