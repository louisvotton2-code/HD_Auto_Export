import type { Metadata } from 'next';
import { siteConfig } from '@/shared/config/site';
import { InterFontFaces } from '@/shared/ui/inter-fonts';
import '../globals.css';
import '@/shared/ui/brand.css';

export const metadata: Metadata = {
  title: 'HD Auto Export · Vehicle publication preview',
  robots: { index: false, follow: false },
  icons: siteConfig.brand.iconUrl,
};

/** Private previews have their own root shell; vehicle data is read only after staff authorization in the browser. */
export default function StaffPreviewLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hans"><head><InterFontFaces /></head><body>{children}</body></html>;
}
