import { proxyPublicRequest } from '@/modules/vehicles/server';

export function GET(request: Request) {
  return proxyPublicRequest(request, ['vehicle-filters'], true);
}
