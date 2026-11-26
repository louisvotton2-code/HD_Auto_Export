import type { Page } from '@playwright/test';

/** Seed a returning visitor only on the isolated site's origin. Preserve subsequent changes. */
export async function seedAcceptedVisitor(page: Page, baseURL: string) {
  await page.addInitScript((origin: string) => {
    if (location.origin !== origin) return;
    if (localStorage.getItem('hd-auto:privacy-choice:v3') !== null ||
        localStorage.getItem('hd-auto:meta-advertising:v2') !== null) return;
    localStorage.setItem('hd-auto:privacy-choice:v3', 'allow');
    localStorage.setItem('hd-auto:meta-advertising:v2', 'allow-sdk');
  }, new URL(baseURL).origin);
}
