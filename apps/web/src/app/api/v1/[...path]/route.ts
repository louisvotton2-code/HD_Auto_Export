import { proxyPublicRequest } from '@/modules/vehicles/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyPublicRequest(request, (await context.params).path);
}
