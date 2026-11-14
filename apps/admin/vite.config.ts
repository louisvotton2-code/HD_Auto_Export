import { defineConfig } from 'vitest/config';
import { adminProxy } from './development-proxy.mjs';

const apiTarget = process.env.ADMIN_API_TARGET ?? 'http://127.0.0.1:3320';
const webTarget = process.env.ADMIN_WEB_TARGET;

export default defineConfig({
  base: '/admin/',
  server: { host: '127.0.0.1', port: 3318, strictPort: true,
    proxy: adminProxy(apiTarget, webTarget ?? 'http://127.0.0.1:3317', true) },
  preview: { host: '127.0.0.1', port: 3319, strictPort: true, proxy: adminProxy(apiTarget, webTarget) },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
