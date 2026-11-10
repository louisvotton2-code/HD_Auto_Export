import { siteConfig } from '@/shared/config/site';

/** Handles notFound thrown by an invalid top-level locale before its layout can render. */
export default function NotFound() {
  return (
    <main
      id="main"
      style={{
        minHeight: '100vh',
        display: 'grid',
        alignContent: 'center',
        justifyItems: 'center',
        gap: 16,
        padding: 24,
        background: '#0a0a0a',
        color: '#f5f0eb',
        fontFamily: 'sans-serif',
      }}
    >
      <img src={siteConfig.brand.logo.src} width={144} height={97} alt="" />
      <span>{siteConfig.name} / 404</span>
      <h1>404</h1>
      <p>Page not found</p>
      <nav aria-label="Choose your language" style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <a href="/zh/" lang="zh-Hans">
          中文首页
        </a>
        <a href="/en/" lang="en">
          Home
        </a>
        <a href="/ru/" lang="ru">
          На главную
        </a>
      </nav>
    </main>
  );
}
