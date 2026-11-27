import { MarketPriceResponseSchema } from '@hd/contracts/public';
import { isPublicApiError, readPublicJson } from '@/modules/vehicles/server';
import { marketPriceApiPath, parseMarketPriceQuery } from '@/modules/market-prices/market-query';
import { publicQueryString } from '@/modules/vehicles';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  const query = parseMarketPriceQuery(new URL(request.url).searchParams);
  if (!query?.success) return Response.json({ error: { code: 'INVALID_REQUEST' } }, { status: 400, headers: noStore });
  try {
    const data = await readPublicJson(`${marketPriceApiPath}?${publicQueryString(query.data)}`, MarketPriceResponseSchema, request.headers);
    return Response.json(data, { headers: noStore });
  } catch (error) {
    const status = isPublicApiError(error) ? error.status : 503;
    const headers = new Headers(noStore);
    if (isPublicApiError(error) && error.retryAfter) headers.set('Retry-After', error.retryAfter);
    return Response.json({ error: { code: status === 429 ? 'RATE_LIMITED' : 'MARKET_PRICE_UNAVAILABLE' } }, { status, headers });
  }
}
