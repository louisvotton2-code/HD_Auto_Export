import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture, setPublicFixtureState } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public vehicle fixture.');
test.beforeEach(async ({ request }) => { await resetPublicFixture(request); });
test.afterEach(async ({ request }) => { await resetPublicFixture(request); });

const copy = {
  zh: { featured: '精选', reserved: '已预订', sold: '已售', available: '可售', nextPhoto: '下一张照片' },
  en: { featured: 'Featured', reserved: 'Reserved', sold: 'Sold', available: 'Available', nextPhoto: 'Next photo' },
  ru: { featured: 'Наш выбор', reserved: 'Забронирован', sold: 'Продан', available: 'В продаже', nextPhoto: 'Следующее фото' },
} as const;

async function expectPhotoStamps(card: Locator, ...labels: string[]) {
  const layer = card.locator('[data-vehicle-stamps]');
  if (labels.length === 0) {
    await expect(layer).toHaveCount(0);
    return;
  }
  await expect(layer.locator('[data-vehicle-stamp]')).toHaveText(labels);
  const visual = await layer.evaluate(element => {
    const photo = element.parentElement!;
    const frame = photo.getBoundingClientRect();
    const stamps = [...element.querySelectorAll('[data-vehicle-stamp]')].map(stamp => stamp.getBoundingClientRect());
    const controls = [...photo.querySelectorAll('button')].filter(button => button.getClientRects().length)
      .map(button => button.getBoundingClientRect());
    return {
      photo: !!photo.querySelector('img,[data-vehicle-photo-unavailable]'),
      accessible: !element.closest('[aria-hidden="true"]'),
      nonBlocking: getComputedStyle(element).pointerEvents === 'none',
      contained: stamps.every(stamp => stamp.left >= frame.left - 1 && stamp.right <= frame.right + 1 &&
        stamp.top >= frame.top - 1 && stamp.bottom <= frame.bottom + 1),
      separate: stamps.every((stamp, index) => index === 0 || stamp.top >= stamps[index - 1]!.bottom - 1),
      controlsClear: stamps.every(stamp => controls.every(control =>
        stamp.right <= control.left + 1 || stamp.left >= control.right - 1 ||
        stamp.bottom <= control.top + 1 || stamp.top >= control.bottom - 1)),
    };
  });
  expect(visual).toEqual({ photo: true, accessible: true, nonBlocking: true, contained: true, separate: true, controlsClear: true });
}

for (const locale of ['zh', 'en', 'ru'] as const) {
  test(`${locale}: photo seals distinguish stock from source across public views at 320px`, async ({ page, request }) => {
    const t = copy[locale];
    await setPublicFixtureState(request, { homeStampSamples: true, externalPublished: true });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('hd-auto:vehicle-favorites:v1',
      JSON.stringify({ version: 1, ids: ['fixture_reserved', 'fixture_sold', 'fixture_external'] })));

    await page.goto(`/${locale}/`);
    await expectPhotoStamps(page.locator('[data-public-vehicle="fixture_reserved"]'), t.featured, t.reserved);
    await expectPhotoStamps(page.locator('[data-public-vehicle="fixture_sold"]'), t.featured, t.sold);
    const featuredExternal = page.locator('[data-public-vehicle="fixture_external"]');
    await expect(featuredExternal).toHaveCount(1);
    await expectPhotoStamps(featuredExternal);

    await page.goto(`/${locale}/cars/?pageSize=48`);
    const available = page.locator('[data-public-vehicle="fixture_car_1"]');
    await expectPhotoStamps(available, t.featured);
    await expect(available.getByText(t.available, { exact: true })).toHaveCount(0);
    await expectPhotoStamps(page.locator('[data-public-vehicle="fixture_reserved"]'), t.featured, t.reserved);
    await expectPhotoStamps(page.locator('[data-public-vehicle="fixture_external"]'));

    await page.locator('header button[aria-controls="vehicle-favorites"]').click();
    const saved = page.locator('#vehicle-favorites');
    await expectPhotoStamps(saved.locator('[data-favorite-vehicle="fixture_reserved"]'), t.featured, t.reserved);
    await expectPhotoStamps(saved.locator('[data-favorite-vehicle="fixture_sold"]'), t.featured, t.sold);
    await expect(saved.locator('[data-favorite-vehicle="fixture_external"] img').first()).toBeVisible();
    await expectPhotoStamps(saved.locator('[data-favorite-vehicle="fixture_external"]'));

    await page.goto(`/${locale}/cars/fixture_sold/`);
    const gallery = page.locator('[data-public-vehicle-gallery]');
    await expect(gallery.getByRole('button', { name: t.nextPhoto, exact: true })).toBeVisible();
    await expectPhotoStamps(gallery, t.featured, t.sold);
    await expect(page.locator('main').getByText(t.sold, { exact: true })).toHaveCount(1);
    await expect(page.locator('main').getByText(t.available, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
