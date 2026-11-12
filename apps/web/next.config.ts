import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { fileURLToPath } from 'node:url';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Validate vehicle metadata before sending HTML, including real 404s and demo noindex.
  htmlLimitedBots: /.*/,
  trailingSlash: true,
  images: { unoptimized: true },
  // Multiple root layouts need a routing-level 404, including the exported 404.html.
  experimental: { globalNotFound: true },
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  async headers() {
    return [{
      source: '/staff/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'same-origin' },
      ],
    }];
  },
};

export default withNextIntl(config);
