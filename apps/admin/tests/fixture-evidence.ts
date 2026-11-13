import { expect, test, type Page } from '@playwright/test';

/** Keep responsive fixture evidence and its overflow checks consistent across suites. */
export async function captureFixtureEvidence(page: Page, name: string) {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`fixture-${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
