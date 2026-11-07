import type { Metadata } from 'next';
import Image from 'next/image';
import { siteConfig } from '@/shared/config/site';
import './globals.css';

export const metadata: Metadata = {
  title: `404 | ${siteConfig.name}`,
  description: 'Page not found. Return to the HD Auto Export calculator.',
  robots: { index: false, follow: true },
};

/** Global static fallback bypasses both root layouts and cannot infer a request language. */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main id="main" className="not-found" style={{ minHeight: '100vh', padding: 24 }}>
          <Image src={siteConfig.brand.logo.src} width={144} height={97} alt="" />
          <span className="eyebrow">{siteConfig.name} / 404</span>
          <h1>404</h1>
          <p>Page not found</p>
          <nav
            aria-label="Choose a calculator language"
            style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}
          >
            <a className="primary-button" href="/zh/calculator/russia/" lang="zh-Hans">
              中文计算器
            </a>
            <a className="primary-button" href="/en/calculator/russia/" lang="en">
              Open calculator
            </a>
            <a className="primary-button" href="/ru/calculator/russia/" lang="ru">
              Калькулятор
            </a>
          </nav>
        </main>
      </body>
    </html>
  );
}
