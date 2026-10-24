import type { Metadata } from 'next';
import { siteConfig } from '@/shared/config/site';
import '../globals.css';

export const metadata: Metadata = {
  title: siteConfig.name,
  robots: { index: false, follow: true },
};

/** Independent root layout for the language-neutral static entry and fallback page. */
export default function EntryLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
