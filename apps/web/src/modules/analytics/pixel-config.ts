export const vehiclePixelPath = /^\/(?:zh|en|ru)\/cars\/([^/]+)\/?$/;

export function isPixelId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[1-9]\d{4,19}$/.test(id);
}

export function getPublicPixelId(enabled: string | undefined, rawId: string | undefined): string | null {
  const id = rawId?.trim();
  return enabled === 'true' && isPixelId(id) ? id : null;
}
