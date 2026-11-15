import { describe, expect, it } from 'vitest';
import { adminProxy } from '../../../vite.config';

const development = 'http://127.0.0.1:3317';
const hmrPath = '/_next/hmr?id=preview-test';

function routeFor(routes: ReturnType<typeof adminProxy>, path: string) {
  return Object.entries(routes).find(([rule]) => new RegExp(rule).test(path))?.[1];
}

describe('staff preview proxy', () => {
  it('only upgrades the Next HMR endpoint when a development upstream is selected', () => {
    const routes = adminProxy(development, true);
    expect(routeFor(routes, hmrPath)).toMatchObject({ target: development, ws: true, changeOrigin: false });
    for (const path of ['/_next/static/chunks/foo.js', '/_next/hmr-extra', '/_next/hmr/unrelated', '/staff/vehicles/id/publication-preview/', '/api/v1/admin/me']) {
      expect(routeFor(routes, path)?.ws).toBeUndefined();
    }
  });

  it('keeps regular previews on HTTP and skips Next entirely without an upstream', () => {
    expect(routeFor(adminProxy(development), hmrPath)).toMatchObject({ target: development });
    expect(routeFor(adminProxy(development), hmrPath)?.ws).toBeUndefined();
    expect(routeFor(adminProxy(), hmrPath)).toBeUndefined();
  });
});
