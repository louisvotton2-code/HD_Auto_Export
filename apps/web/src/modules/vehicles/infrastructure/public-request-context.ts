import { isIP } from 'node:net';
import { headers } from 'next/headers';

type IncomingHeaders = Pick<Headers, 'get'>;

/** Opt-in deployment boundary: the private web service is reachable only through a
 * gateway that overwrites X-HD-Visitor-IP from its connection peer. Never read XFF. */
export function trustedVisitorHeaders(incoming: IncomingHeaders): Record<string, string> {
  if (process.env.VEHICLE_API_TRUST_PROXY_IP !== 'true') return {};
  const ip = incoming.get('x-hd-visitor-ip');
  if (!ip || /[\s,%]/.test(ip) || !isIP(ip)) return {};
  // Construct one fresh value. API trusts it only when its peer is the fixed web /32.
  return { 'X-Forwarded-For': ip };
}

export async function publicRequestHeaders(incoming?: IncomingHeaders) {
  if (process.env.VEHICLE_API_TRUST_PROXY_IP !== 'true') return {};
  return trustedVisitorHeaders(incoming ?? (await headers()));
}
