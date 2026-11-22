import type { Metadata } from 'next';
import { siteConfig } from '@/shared/config/site';
import { InterFontFaces } from '@/shared/ui/inter-fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: siteConfig.name,
  robots: { index: false, follow: true },
  icons: siteConfig.brand.iconUrl,
  other: siteConfig.domainVerification,
};

/** Independent root layout for the language-neutral static entry and fallback page. */
export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head><InterFontFaces /></head>
      <body>{children}</body>
    </html>
  );
}
