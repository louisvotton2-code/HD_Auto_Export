import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Multiple root layouts need a routing-level 404, including the exported 404.html.
  experimental: { globalNotFound: true },
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
};

export default withNextIntl(config);
