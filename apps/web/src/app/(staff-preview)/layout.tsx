import type { Metadata } from 'next';
import '../globals.css';
import '@/shared/ui/brand.css';

export const metadata: Metadata = {
  title: 'HD Auto Export · Vehicle publication preview',
  robots: { index: false, follow: false },
};

/** Private previews have their own root shell; vehicle data is read only after staff authorization in the browser. */
export default function StaffPreviewLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hans"><body>{children}</body></html>;
}
