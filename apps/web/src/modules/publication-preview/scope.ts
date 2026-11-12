import { PublicationPreviewFrameMessageSchema, type PublicationPreviewFrameMessage } from '@hd/contracts/admin';

export type PreviewFrameScope = Pick<PublicationPreviewFrameMessage, 'loadId' | 'vehicleId' | 'locale'>;

export function parsePreviewFrameScope(vehicleId: unknown, locale: unknown, loadId: unknown): PreviewFrameScope | null {
  const result = PublicationPreviewFrameMessageSchema.safeParse({
    schemaVersion: 1,
    type: 'hd:auto:publication-preview',
    event: 'loading',
    vehicleId,
    locale: locale === undefined ? 'zh' : locale,
    loadId,
  });
  return result.success
    ? { vehicleId: result.data.vehicleId, locale: result.data.locale, loadId: result.data.loadId }
    : null;
}
