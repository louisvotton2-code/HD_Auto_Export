import { expect, type Locator } from '@playwright/test';

/** Assertions for the bounded synthetic stored report, shared by detail regressions. */
export async function expectInlineInspection(section: Locator) {
  await expect(section).toHaveAttribute('id', 'inspection');
  await expect(section.locator('[data-inspection-conclusion]')).toHaveCount(1);
  await expect(section.locator('[data-inspection-defect]')).toHaveCount(2);
  await expect(section.locator('[data-inspection-defect] strong')).toHaveText(['Body part 1', 'Body part 2']);
  await expect(section.locator('[data-inspection-defect] p')).toHaveText(['Recorded issue', 'Recorded issue']);
  await expect(section.locator('a[href*="/inspection/"]')).toHaveCount(0);
  await expect(section.locator('button')).toHaveCount(0);
}
