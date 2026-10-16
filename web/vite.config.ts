import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

const appRoot = resolve(import.meta.dirname);

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, appRoot, '');
  const base = env.VITE_BASE_URL || '/';
  const enableProxy = command === 'serve' && env.VITE_HTTP_PROXY === 'Y';
  const paypalApiBase = env.VITE_PAYPAL_API_TARGET || 'http://127.0.0.1:3025';
  const host = env.VITE_HOST || '0.0.0.0';
  const port = Number(env.VITE_PORT || 9713);

  // preview 也需要代理：否则 /api/paypal/* 会落到 SPA HTML，列表永远为空
  const proxy: Record<string, object> = {
    '^/api/paypal': {
      target: paypalApiBase,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/paypal/, '/api')
    }
  };

  return {
    base,
    root: appRoot,
    resolve: {
      alias: {
        '@': resolve(appRoot, 'src')
      }
    },
    plugins: [vue()],
    define: {
      __APP_CODE__: JSON.stringify(env.VITE_APP_CODE || 'paypal')
    },
    server: {
      host,
      port,
      strictPort: true,
      open: command === 'serve',
      proxy: enableProxy ? proxy : undefined
    },
    preview: {
      host,
      port,
      strictPort: true,
      proxy
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      reportCompressedSize: false
    }
  };
});
