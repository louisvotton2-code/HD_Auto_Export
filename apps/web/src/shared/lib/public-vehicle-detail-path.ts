export function isPublicVehicleDetailPath(path: string): boolean {
  return /^\/(?:zh|en|ru)\/cars\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}(?:\/inspection)?\/?(?:[?#]|$)/.test(path);
}
