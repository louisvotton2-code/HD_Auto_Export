import { connection } from 'next/server';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { InvalidPublicationPreview, PublicationPreviewResource, parsePreviewFrameScope } from '@/modules/publication-preview';

export default async function PublicationPreviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const scope = parsePreviewFrameScope(id, query.locale, query.loadId);
  if (!scope) {
    return <InvalidPublicationPreview locale={hasLocale(routing.locales, query.locale) ? query.locale : 'zh'} />;
  }
  return <PublicationPreviewResource key={`${scope.vehicleId}:${scope.locale}:${scope.loadId}`} scope={scope} />;
}
