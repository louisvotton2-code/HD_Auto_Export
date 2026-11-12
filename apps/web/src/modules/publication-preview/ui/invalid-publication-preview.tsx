import type { Locale } from '@/i18n/routing';
import { previewContent } from '../content';
import styles from './publication-preview-resource.module.css';

export function InvalidPublicationPreview({ locale }: { locale: Locale }) {
  const t = previewContent[locale];
  return (
    <main id="main" lang={locale} className={styles.status} data-testid="publication-preview-status">
      <h1>{t.title}</h1>
      <p role="alert">{t.errors.invalid_request}</p>
    </main>
  );
}
