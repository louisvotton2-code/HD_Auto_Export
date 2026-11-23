import { createHtmlCacheServer, readBrowseGeneration, readHtmlCacheKey } from './html-cache.mjs';

const origin = new URL(process.env.HD_HTML_CACHE_ORIGIN);
if (!/^web-(blue|green)$/.test(origin.hostname) || origin.port !== '3000') {
  throw new Error('Use the fixed Web service for the current slot');
}
const protocol = process.env.HD_HTML_CACHE_PROTOCOL;
const authorityOrigin = protocol === '4' ? new URL(process.env.HD_BROWSE_AUTHORITY_ORIGIN) : undefined;
if (authorityOrigin && (authorityOrigin.hostname !== origin.hostname.replace('web-', 'api-') ||
    authorityOrigin.port !== '3320' || process.env.HD_BROWSE_AUTHORITY_SECRET_FILE !== '/run/secrets/ssr_service_secret')) {
  throw new Error('Use the fixed API service and mounted private credential for the current slot');
}
createHtmlCacheServer({
  origin,
  siteHost: process.env.HD_HTML_CACHE_SITE_HOST,
  edgeIp: process.env.HD_HTML_CACHE_EDGE_IP,
  release: process.env.HD_RELEASE_ID,
  secret: readHtmlCacheKey(process.env.HD_HTML_CACHE_SECRET_FILE),
  cacheProtocol: protocol,
  browseAuthorityOrigin: authorityOrigin,
  browseAuthorityKey: authorityOrigin ? readHtmlCacheKey(process.env.HD_BROWSE_AUTHORITY_SECRET_FILE) : undefined,
  readGeneration: process.env.HD_BROWSE_GENERATION_FILE === '/run/hd-browse/generation'
    ? () => readBrowseGeneration('/run/hd-browse/generation') : undefined,
}).listen(3010, '0.0.0.0');
