/** A source import with a content fingerprint can share one URL across SSR and navigation. */
export function siteAssetUrl(imported: string): string {
  // Turbopack can append dpl to client-side asset imports. The gateway retains these files by path.
  return imported.replace(/^(\/_next\/static\/media\/[\w.-]+)\?dpl=[\w.%~-]+$/, '$1');
}
