import { expect, test } from '@playwright/test';

for (const [width, columns] of [
  [320, 2],
  [390, 2],
  [767, 2],
  [768, 3],
  [1023, 3],
  [1024, 3],
  [1280, 4],
  [1440, 4],
]) {
  test(`parts follows the supplied React layout: ${width}px and ${columns} columns`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto('/ru/parts/');
    const geometry = await page
      .locator('main [data-part]')
      .first()
      .evaluate((card) => {
        const grid = card.parentElement!;
        const filters = document.querySelector('#parts-filters')!;
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          grid: grid.getBoundingClientRect().toJSON(),
          filters: filters.getBoundingClientRect().toJSON(),
          page: document.documentElement.scrollWidth,
          view: innerWidth,
          maxWidth: getComputedStyle(document.querySelector('main > div')!).maxWidth,
        };
      });
    expect(geometry.columns).toBe(columns);
    expect(geometry.maxWidth).toBe('1280px');
    expect(geometry.page).toBeLessThanOrEqual(geometry.view + 1);
    if (width >= 1024) expect(geometry.filters.right).toBeLessThanOrEqual(geometry.grid.left);
    else expect(geometry.filters.bottom).toBeLessThanOrEqual(geometry.grid.top);
    const cards = page.locator('main [data-part]');
    expect(await cards.count()).toBe(44);
    const actionFits = await cards.evaluateAll((nodes) =>
      nodes.every((node) => {
        const footer = node.querySelector('footer') ?? node.lastElementChild?.lastElementChild;
        if (!footer) return false;
        const rect = node.getBoundingClientRect();
        return (
          footer.getBoundingClientRect().right <= rect.right &&
          footer.scrollWidth <= footer.clientWidth + 1
        );
      }),
    );
    expect(actionFits).toBe(true);
  });
}
