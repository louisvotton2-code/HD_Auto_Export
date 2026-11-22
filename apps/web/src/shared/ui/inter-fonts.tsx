import cyrillic from '../../../public/fonts/inter-cyrillic.woff2?site-asset';
import latin from '../../../public/fonts/inter-latin.woff2?site-asset';
import { siteAssetUrl } from '@/shared/config/site-asset';

export const interFontUrls = { latin: siteAssetUrl(latin), cyrillic: siteAssetUrl(cyrillic) };

const subsets = [
  { url: interFontUrls.cyrillic, range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
  { url: interFontUrls.latin, range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
];

export function InterFontFaces({ home = false }: { home?: boolean }) {
  // Keep the preload and the font face on the same URL. Standalone Next adds a
  // deployment query to URLs emitted by its CSS pipeline, even for unchanged bytes.
  const family = home ? 'Inter Home' : 'Inter';
  const display = home ? 'optional' : 'swap';
  const rules = subsets.map(({ url, range }) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;font-display:${display};src:url('${url}') format('woff2');unicode-range:${range}}`,
  ).join('');
  return <style href={home ? 'hd-inter-home' : 'hd-inter'} precedence="fonts">{rules}</style>;
}
