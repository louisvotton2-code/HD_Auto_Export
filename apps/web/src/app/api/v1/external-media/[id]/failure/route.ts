import { proxyExternalPhotoFailure } from '@/modules/vehicles/server';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return proxyExternalPhotoFailure(request, (await context.params).id);
}
