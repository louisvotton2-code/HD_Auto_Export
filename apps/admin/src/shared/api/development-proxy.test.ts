import { describe, expect, it } from 'vitest';
import { adminProxy } from '../../../development-proxy.mjs';

const api = 'http://127.0.0.1:3320';
const web = 'http://127.0.0.1:3317';

function route(path: string, routes = adminProxy(api, web, true)) {
  return Object.entries(routes).find(([pattern]) => new RegExp(pattern).test(path))?.[1];
}

describe('same-origin staff preview proxy', () => {
  it('routes the shell, scripts and development socket to the same web target', () => {
    expect(route('/staff/vehicles/mock/publication-preview/?locale=zh')).toMatchObject({ target: web, changeOrigin: false });
    expect(route('/_next/static/chunks/preview.js')).toMatchObject({ target: web, changeOrigin: false });
    expect(route('/_next/hmr?id=preview')).toMatchObject({ target: web, ws: true });
    expect(route('/staffing')).toBeUndefined();
  });
  it('routes authenticated content and images independently of the web proxy', () => {
    for (const path of ['/api/v1/admin/vehicles/mock/publication-preview?locale=zh', '/api/v1/admin/media/mock/preview']) {
      expect(route(path)).toMatchObject({ target: api, changeOrigin: false });
    }
    expect(route('/_next/static/chunks/preview.js', adminProxy(api))).toBeUndefined();
    expect(route('/_next/hmr', adminProxy(api, web))?.ws).toBeUndefined();
  });
});
