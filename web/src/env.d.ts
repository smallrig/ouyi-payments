/// <reference types="vite/client" />

declare const __APP_CODE__: string;

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_CODE: string;
  readonly VITE_HTTP_PROXY?: string;
  readonly VITE_SERVICE_BASE_URL: string;
  readonly VITE_AUTH_API_PREFIX?: string;
  readonly VITE_PORTAL_URL?: string;
  readonly VITE_STANDALONE_AUTH?: string;
  readonly VITE_PAYPAL_API_BASE?: string;
  readonly VITE_PAYPAL_API_TARGET?: string;
  readonly VITE_PAYPAL_OAUTH_START?: string;
  readonly VITE_PAYPAL_REDIRECT_URI?: string;
  readonly VITE_PAYPAL_WEBHOOK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
