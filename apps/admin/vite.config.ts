import { defineConfig } from 'vitest/config';
import type { ProxyOptions } from 'vite';

export function adminProxy(webTarget?: string, development = false): Record<string, ProxyOptions> {
  const routes: Record<string, ProxyOptions> = {
    '^/api(?:/|\\?|$)': { target: process.env.ADMIN_API_TARGET ?? 'http://127.0.0.1:3320', changeOrigin: false },
  };
  if (webTarget) {
    routes['^/staff(?:/|\\?|$)'] = { target: webTarget, changeOrigin: false };
    if (development) routes['^/_next/hmr(?:\\?|$)'] = { target: webTarget, changeOrigin: false, ws: true };
    routes['^/_next(?:/|\\?|$)'] = { target: webTarget, changeOrigin: false };
  }
  return routes;
}

export default defineConfig({
  base: '/admin/',
  server: { host: '127.0.0.1', port: 3318, strictPort: true, proxy: adminProxy(process.env.ADMIN_WEB_TARGET ?? 'http://127.0.0.1:3317', true) },
  preview: { host: '127.0.0.1', port: 3319, strictPort: true, proxy: adminProxy(process.env.ADMIN_WEB_TARGET, process.env.ADMIN_PREVIEW_WEB_DEV_PROXY === '1') },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
