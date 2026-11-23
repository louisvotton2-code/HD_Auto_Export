import {
  PUBLIC_BROWSE_CACHE_MAX_TTL_MS, PUBLIC_BROWSE_CACHE_POLICY, PUBLIC_BROWSE_CACHE_POLICY_HEADER,
  PUBLIC_BROWSE_EXPIRES_AT_HEADER, PUBLIC_BROWSE_GENERATED_AT_HEADER, PUBLIC_BROWSE_GENERATION_HEADER,
} from '@hd/contracts/public';

export type PublicBrowseStamp = { generation: string; observedAt: number; expiresAt: number };

function timestamp(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
}

export function parsePublicBrowseStamp(headers: Pick<Headers, 'get'>, now = Date.now()): PublicBrowseStamp | null {
  const generation = headers.get(PUBLIC_BROWSE_GENERATION_HEADER);
  const observedAt = timestamp(headers.get(PUBLIC_BROWSE_GENERATED_AT_HEADER));
  const expiresAt = timestamp(headers.get(PUBLIC_BROWSE_EXPIRES_AT_HEADER));
  if (headers.get(PUBLIC_BROWSE_CACHE_POLICY_HEADER) !== PUBLIC_BROWSE_CACHE_POLICY ||
      !generation || !/^[a-f0-9]{64}$/.test(generation) || observedAt <= 0 ||
      !(observedAt <= now && now < expiresAt && expiresAt <= observedAt + PUBLIC_BROWSE_CACHE_MAX_TTL_MS)) return null;
  return { generation, observedAt, expiresAt };
}
