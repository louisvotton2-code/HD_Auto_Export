import {
  PublicationPreviewResponseSchema,
  type PublicationPreview,
  type PublicationPreviewFrameMessage,
} from '@hd/contracts/admin';
import type { PreviewFrameScope } from './scope';

export type PreviewErrorCode = Extract<PublicationPreviewFrameMessage, { event: 'error' }>['error']['code'];

export class PreviewReadError extends Error {
  constructor(readonly code: PreviewErrorCode) {
    super(code);
  }
}

export function validatePreviewScope(preview: PublicationPreview, scope: PreviewFrameScope): PublicationPreview {
  // The vehicle's actual text language may differ; its requested scope must match this frame.
  const values = [
    preview.vehicle.content.title, preview.vehicle.content.description,
    preview.vehicle.display.make, preview.vehicle.display.model, preview.vehicle.display.trim,
    preview.vehicle.display.generation, preview.vehicle.display.city, preview.vehicle.display.location,
    preview.vehicle.display.platform,
    ...preview.vehicle.display.priceIncludes.map((item) => item.value),
    ...preview.vehicle.display.mediaAlt.map((item) => item.value),
  ];
  if (preview.vehicle.id !== scope.vehicleId || preview.locale !== scope.locale || values.some((value) => value.requestedLocale !== scope.locale)) {
    throw new PreviewReadError('invalid_response');
  }
  return preview;
}

export async function readPublicationPreview(scope: PreviewFrameScope, signal: AbortSignal): Promise<PublicationPreview> {
  const url = `/api/v1/admin/vehicles/${encodeURIComponent(scope.vehicleId)}/publication-preview?${new URLSearchParams({ locale: scope.locale })}`;
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const codes: Record<number, PreviewErrorCode> = {
      401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict',
    };
    await response.body?.cancel();
    throw new PreviewReadError(codes[response.status] ?? 'unavailable');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new PreviewReadError('invalid_response');
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new PreviewReadError('invalid_response'); }
  const parsed = PublicationPreviewResponseSchema.safeParse(body);
  if (!parsed.success) throw new PreviewReadError('invalid_response');
  return validatePreviewScope(parsed.data.data, scope);
}
