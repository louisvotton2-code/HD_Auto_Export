import type { ProxyOptions } from 'vite';

export function adminProxy(apiTarget: string, webTarget?: string, webDevelopment = false): Record<string, ProxyOptions> {
  const proxy: Record<string, ProxyOptions> = {
    '^/api(?:/|\\?|$)': { target: apiTarget, changeOrigin: false },
  };
  if (webTarget) {
    proxy['^/staff(?:/|\\?|$)'] = { target: webTarget, changeOrigin: false };
    // Next's development socket belongs to the same upstream as its shell and chunks.
    if (webDevelopment) proxy['^/_next/hmr(?:/|\\?|$)'] = { target: webTarget, changeOrigin: false, ws: true };
    proxy['^/_next(?:/|\\?|$)'] = { target: webTarget, changeOrigin: false };
  }
  return proxy;
}
