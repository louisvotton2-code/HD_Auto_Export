import { defineConfig } from 'vitest/config';

const proxy = { '/api': { target: process.env.ADMIN_API_TARGET ?? 'http://127.0.0.1:3320', changeOrigin: false } };

export default defineConfig({
  base: '/admin/',
  server: { host: '127.0.0.1', port: 3318, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 3319, strictPort: true, proxy },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
