import { expect, test, type Locator } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.skip(!process.env.PUBLIC_FIXTURE_API_URL, 'Requires the isolated public catalog fixture.');
test.beforeEach(async ({ request }) => resetPublicFixture(request));
test.afterEach(async ({ request }) => resetPublicFixture(request));

async function geometry(track: Locator) {
  return track.evaluate(node => {
    const original = node.querySelector<HTMLElement>('[data-brand-group="original"]');
    const copy = node.querySelector<HTMLElement>('[data-brand-group="copy"]');
    if (!original || !copy) throw new Error('Two complete brand groups are required.');
    const style = getComputedStyle(node);
    const duration = style.animationDuration.trim();
    const first = original.getBoundingClientRect();
    const second = copy.getBoundingClientRect();
    return {
      width: first.width,
      copyWidth: second.width,
      separation: second.left - first.left,
      distance: Number.parseFloat(style.getPropertyValue('--brand-distance')),
      seconds: Number.parseFloat(duration) / (duration.endsWith('ms') ? 1000 : 1),
      playState: style.animationPlayState,
    };
  });
}

async function expectConstantSpeed(track: Locator) {
  const measured = await geometry(track);
  expect(measured.width).toBeGreaterThan(0);
  expect(measured.seconds).toBeGreaterThan(1);
  expect(measured.copyWidth).toBeCloseTo(measured.width, 2);
  expect(measured.distance).toBeCloseTo(measured.width, 2);
  // The trailing inter-group gap belongs to the first measured repeat as well.
  expect(measured.separation).toBeCloseTo(measured.width, 2);
  expect(measured.width / measured.seconds).toBeCloseTo(28, 2);
}

/** Seek the real CSS animation rather than timing frames against a loaded CI machine. */
async function oneSecondDisplacement(track: Locator) {
  return track.evaluate(async node => {
    const original = node.querySelector<HTMLElement>('[data-brand-group="original"]');
    const copy = node.querySelector<HTMLElement>('[data-brand-group="copy"]');
    const animation = node.getAnimations()[0];
    if (!original || !copy || !animation) throw new Error('The running marquee animation is required.');
    await animation.ready;
    const previousTime = animation.currentTime;
    // Avoid play()/pause(): those can override CSS animation-play-state and invalidate
    // the later hover assertion. Seeking the time leaves CSS in charge of its play state.
    animation.currentTime = 0;
    const from = [original.getBoundingClientRect().left, copy.getBoundingClientRect().left] as const;
    animation.currentTime = 1000;
    const to = [original.getBoundingClientRect().left, copy.getBoundingClientRect().left] as const;
    animation.currentTime = previousTime;
    return { original: from[0] - to[0], copy: from[1] - to[1] };
  });
}

async function stationaryDisplacement(track: Locator) {
  return track.evaluate(async node => {
    const original = node.querySelector<HTMLElement>('[data-brand-group="original"]');
    if (!original) throw new Error('The original brand group is required.');
    const before = original.getBoundingClientRect().left;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return original.getBoundingClientRect().left - before;
  });
}

test('brand marquee keeps 28px/s after its repeat width changes, with identical copies, hover pause and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/');
  await page.evaluate(() => document.fonts.ready);
  const wrapper = page.locator('[data-brand-marquee]');
  const track = wrapper.locator('[data-brand-speed]');
  await expect(wrapper).toBeVisible();
  await expect(track).toHaveAttribute('data-marquee-ready', 'true');
  await expect(wrapper.locator('[data-brand-group]')).toHaveCount(2);
  await expect(wrapper.locator('[data-brand-group="copy"]')).toHaveAttribute('aria-hidden', 'true');
  await page.mouse.move(1, 1);
  await expect.poll(async () => (await geometry(track)).playState).toBe('running');
  await expectConstantSpeed(track);
  const before = await geometry(track);
  const firstMotion = await oneSecondDisplacement(track);
  expect(firstMotion.original).toBeCloseTo(28, 1);
  expect(firstMotion.copy).toBeCloseTo(firstMotion.original, 2);

  // Change both visible text copies as a font/brand-width change would, without dispatching
  // a window resize. The original group's ResizeObserver must update distance and duration.
  await wrapper.evaluate(node => {
    for (const group of node.querySelectorAll('[data-brand-group]')) {
      const brand = group.querySelector('span');
      if (!brand) throw new Error('At least one real brand is required.');
      brand.textContent += ' EXTENDED BRAND NAME FOR WIDTH CHANGE';
    }
  });
  await expect.poll(async () => (await geometry(track)).width).toBeGreaterThan(before.width + 20);
  await expect.poll(async () => {
    const measured = await geometry(track);
    return Math.abs(measured.distance - measured.width) < 0.01 && Math.abs(measured.width / measured.seconds - 28) < 0.01;
  }).toBe(true);
  const resized = await geometry(track);
  expect(resized.seconds).toBeGreaterThan(before.seconds);
  await expectConstantSpeed(track);
  const resizedMotion = await oneSecondDisplacement(track);
  expect(resizedMotion.original).toBeCloseTo(28, 1);
  expect(resizedMotion.copy).toBeCloseTo(resizedMotion.original, 2);

  await wrapper.hover();
  await expect.poll(async () => (await geometry(track)).playState).toBe('paused');
  expect(Math.abs(await stationaryDisplacement(track))).toBeLessThan(0.1);
  await page.mouse.move(1, 1);
  await expect.poll(async () => (await geometry(track)).playState).toBe('running');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => track.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(Math.abs(await stationaryDisplacement(track))).toBeLessThan(0.1);
  await expect(wrapper.locator('[data-brand-group="original"] span').first()).toBeVisible();
});
