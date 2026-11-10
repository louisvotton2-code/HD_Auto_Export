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
    expect(await cards.count()).toBe(12);
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

test('native select leaves room for its arrow and opens aligned beneath the field', async ({ page }) => {
  await page.goto('/en/parts/');
  const select = page.locator('select[name="brand"]');
  await select.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const trigger = await select.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      padding: style.paddingRight,
      arrow: style.backgroundPosition,
      supportsPicker: CSS.supports('appearance', 'base-select'),
    };
  });
  expect(trigger.padding).toBe('32px');
  expect(trigger.arrow).toContain('12px');
  if (!trigger.supportsPicker) return;

  await select.click();
  const geometry = await select.evaluate((node) => {
    const field = node.getBoundingClientRect();
    const firstOption = node.querySelector('option')!.getBoundingClientRect();
    const picker = getComputedStyle(node, '::picker(select)');
    const leftInset = parseFloat(picker.borderLeftWidth) + parseFloat(picker.paddingLeft);
    return {
      open: node.matches(':open'),
      leftDelta: firstOption.left - leftInset - field.left,
      gap: firstOption.top - field.bottom,
      widthDelta: parseFloat(picker.width) - field.width,
    };
  });
  expect(geometry.open).toBe(true);
  expect(Math.abs(geometry.leftDelta)).toBeLessThan(1);
  expect(Math.abs(geometry.widthDelta)).toBeLessThan(1);
  expect(geometry.gap).toBeGreaterThan(0);
  expect(geometry.gap).toBeLessThan(16);
  await page.keyboard.press('Escape');
  await expect(select).not.toHaveCSS('outline-style', 'none');
});
