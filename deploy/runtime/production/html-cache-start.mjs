import { createHtmlCacheServer, readHtmlCacheKey } from './html-cache.mjs';

const origin = new URL(process.env.HD_HTML_CACHE_ORIGIN);
if (!/^web-(blue|green)$/.test(origin.hostname) || origin.port !== '3000') {
  throw new Error('Use the fixed Web service for the current slot');
}
createHtmlCacheServer({
  origin,
  siteHost: process.env.HD_HTML_CACHE_SITE_HOST,
  edgeIp: process.env.HD_HTML_CACHE_EDGE_IP,
  release: process.env.HD_RELEASE_ID,
  secret: readHtmlCacheKey(process.env.HD_HTML_CACHE_SECRET_FILE),
}).listen(3010, '0.0.0.0');
