import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { siteConfig } from '@/shared/config/site';

export default async function NotFound() {
  const t = await getTranslations('Common');
  return (
    <main id="main" className="not-found">
      <span className="eyebrow">{siteConfig.name} / 404</span>
      <h1>404</h1>
      <Link className="primary-button" href="/calculator">
        {t('backHome')}
      </Link>
    </main>
  );
}
