import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetPublicFixture } from './helpers/public-fixture';

test.beforeEach(async ({ request }) => {
  await resetPublicFixture(request);
});
test.afterEach(async ({ request }) => {
  await resetPublicFixture(request);
});

async function rotation(card: Locator) {
  return card.evaluate((node) => {
    const transform = getComputedStyle(node).transform;
    const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    return { transform, x: matrix.m13, y: matrix.m23 };
  });
}

async function expectFlat(card: Locator) {
  await expect
    .poll(async () => {
      const { x, y } = await rotation(card);
      return Math.abs(x) + Math.abs(y);
    })
    .toBeLessThan(0.0001);
}

test('the mobile light crosses a fixed frame in both directions and settles after scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/');
  const hero = page.locator('[data-home-section="hero"]');
  const image = hero.locator('img[src^="/media/home/dawn-convoy.webp"]');
  const light = hero.getByTestId('hero-road-light');
  const frame = image.locator('..');
  const progress = () =>
    hero.evaluate((node) => Number.parseFloat(node.style.getPropertyValue('--drive-progress')));
  const translation = () =>
    light.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
  const scroll = (top: number) =>
    page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), top);
  const sampledChange = () =>
    hero.evaluate(async (node) => {
      const initial = node.style.getPropertyValue('--drive-progress');
      for (let frame = 0; frame < 8; frame++) {
        await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      }
      return node.style.getPropertyValue('--drive-progress') !== initial;
    });

  await expect(hero.locator('canvas')).toHaveCount(0);
  await expect(hero.getByRole('button', { name: 'Pause autoplay' })).toHaveCount(0);
  await expect.poll(progress).toBe(0);
  const initialImage = await image.evaluate((node) => getComputedStyle(node).transform);
  const initialLight = await translation();
  const frameWidth = (await frame.boundingBox())!.width;
  const lightWidth = await light.evaluate((node) => getComputedStyle(node, '::before').width);
  const lightOpacity = await light.evaluate((node) => getComputedStyle(node).opacity);
  await scroll(96);
  await expect.poll(progress).toBeGreaterThan(0.25);
  await expect.poll(sampledChange).toBe(false);
  const forward = await progress();
  const forwardLight = await translation();
  expect(forwardLight).toBeGreaterThan(initialLight);
  expect((await frame.boundingBox())!.width).toBeCloseTo(frameWidth, 2);
  expect(await light.evaluate((node) => getComputedStyle(node, '::before').width)).toBe(lightWidth);
  await expect(image).not.toHaveCSS('transform', initialImage);

  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(sampledChange).toBe(false);
  expect(await progress()).toBeCloseTo(forward, 2);

  await scroll(48);
  await expect.poll(progress).toBeLessThan(forward - 0.07);
  await expect.poll(sampledChange).toBe(false);
  const backward = await progress();
  expect(backward).toBeGreaterThan(0);
  expect(await translation()).toBeLessThan(forwardLight);

  await scroll(330);
  await expect.poll(progress).toBe(1);
  expect((await frame.boundingBox())!.width).toBeCloseTo(frameWidth, 2);
  expect(await light.evaluate((node) => getComputedStyle(node, '::before').width)).toBe(lightWidth);
  await expect(light).toHaveCSS('opacity', lightOpacity);
  expect(await translation()).toBeGreaterThan(frameWidth);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(image).toHaveCSS('transform', 'none');
  await expect(light).toHaveCSS('opacity', '0');
  const scrollCue = hero.getByRole('link', { name: 'Scroll down' });
  await expect(scrollCue).toHaveText('Scroll down');
  await expect(scrollCue.locator('span[aria-hidden]')).toHaveCSS('animation-name', 'none');
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname.replace(/\/$/, '');
    if (path === '/api/v1/home/vehicles' || path === '/api/v1/vehicle-filters') {
      dataRequests.push(path);
    }
  });
  await scrollCue.click();
  await expect(page).toHaveURL(/#home-vehicles$/);
  await expect
    .poll(() => page.locator('#home-vehicles').evaluate((section) =>
      Math.round(section.getBoundingClientRect().top),
    ))
    .toBe(84);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/#home-vehicles$/);
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(dataRequests).toEqual([]);
});

test.describe('touch scrolling on the homepage', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function openLegacyTouchHome(page: Page) {
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (property: string, value?: string) =>
        property === 'animation-timeline' ? false : value === undefined ? supports(property) : supports(property, value);
    });
    await page.goto('/en/');
    await page.addStyleTag({ content: '[data-testid="hero-road-light"], [data-home-section="hero"] img { animation: none !important; }' });
  }

  test('the light is visible on the first large touch scroll step in either direction', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openLegacyTouchHome(page);
    const hero = page.locator('[data-home-section="hero"]');
    const light = hero.getByTestId('hero-road-light');
    await expect(hero).toHaveAttribute('style', /--drive-progress:\s*0\.000/);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    const sampleScroll = (top: number) => light.evaluate((node, scrollTop) => new Promise<{
      visibleHeight: number;
      stripePosition: number;
    }>((resolve) => {
      window.addEventListener('scroll', () => {
        const frame = node.parentElement!.getBoundingClientRect();
        const headerBottom = document.querySelector('.site-header')!.getBoundingClientRect().bottom;
        const from = Math.max(frame.top, headerBottom);
        const to = Math.min(frame.bottom, innerHeight);
        const offsetFromCenter = (from + to - frame.top - frame.bottom) / 2;
        const transform = new DOMMatrixReadOnly(getComputedStyle(node).transform);
        const stripe = getComputedStyle(node, '::before');
        const skew = new DOMMatrixReadOnly(stripe.transform).c;
        const stripeX = transform.m41 + parseFloat(stripe.width) + skew * offsetFromCenter;
        resolve({ visibleHeight: to - from, stripePosition: stripeX / frame.width });
      }, { once: true });
      window.scrollTo({ top: scrollTop, behavior: 'instant' });
    }), top);

    const down = await sampleScroll(170);
    await page.evaluate(() => window.scrollTo({ top: 340, behavior: 'instant' }));
    await expect(hero).toHaveAttribute('style', /--drive-progress:\s*1\.000/);
    const up = await sampleScroll(170);

    for (const sample of [down, up]) {
      expect(sample.visibleHeight).toBeGreaterThan(100);
      expect(sample.stripePosition).toBeGreaterThan(0.05);
      expect(sample.stripePosition).toBeLessThan(0.96);
    }
  });

  test('toolbar height changes cannot reverse the light during a swipe', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openLegacyTouchHome(page);
    const hero = page.locator('[data-home-section="hero"]');
    const progress = () =>
      hero.evaluate((node) => Number.parseFloat(node.style.getPropertyValue('--drive-progress')));
    const swipe = (
      type: 'touchstart' | 'touchmove' | 'touchend',
      screenY: number,
      scrollTop?: number,
    ) =>
      page.evaluate(({ type, screenY, scrollTop }) => {
        const gesture = new Event(type);
        Object.defineProperty(gesture, 'touches', {
          value: type === 'touchend' ? [] : [{ screenY }],
        });
        window.dispatchEvent(gesture);
        if (scrollTop !== undefined) window.scrollTo({ top: scrollTop, behavior: 'instant' });
      }, { type, screenY, scrollTop });
    const expectStable = async (expected: number) => {
      const observed = await hero.evaluate(async (node) => {
        const values: number[] = [];
        for (let frame = 0; frame < 8; frame++) {
          await new Promise<number>((resolve) => requestAnimationFrame(resolve));
          values.push(Number.parseFloat(node.style.getPropertyValue('--drive-progress')));
        }
        return values;
      });
      for (const value of observed) expect(value).toBe(expected);
    };

    const cue = hero.getByRole('link', { name: 'Scroll down' });
    const arrows = cue.locator('span[aria-hidden]');
    await expect(arrows.locator('svg')).toHaveCount(2);
    await cue.scrollIntoViewIfNeeded();
    await expect(arrows).toHaveCSS('animation-iteration-count', 'infinite');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(progress).toBe(0);
    await swipe('touchstart', 550);
    await swipe('touchmove', 500, 120);
    await expect.poll(progress).toBe(0.427);

    await page.setViewportSize({ width: 390, height: 920 });
    await swipe('touchmove', 490, 86);
    await expectStable(0.427);
    await swipe('touchmove', 440, 154);
    await expect.poll(progress).toBe(0.548);

    await swipe('touchmove', 470, 110);
    await expect.poll(progress).toBe(0.392);
    await page.setViewportSize({ width: 390, height: 844 });
    await swipe('touchmove', 485, 140);
    await expectStable(0.392);
    await swipe('touchend', 485, 136);
    await expectStable(0.392);
    await swipe('touchstart', 480);
    await swipe('touchmove', 500, 64);
    await expect.poll(progress).toBe(0.228);

    await cue.evaluate((link) => window.scrollTo({
      top: window.scrollY + link.getBoundingClientRect().bottom + 20,
      behavior: 'instant',
    }));
    await expect(arrows).toHaveCSS('animation-name', 'none');
  });

  test('legacy touch scrolling advances the light while the browser is still holding its scroll offset', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openLegacyTouchHome(page);
    const hero = page.locator('[data-home-section="hero"]');
    const progress = () => hero.evaluate((node) => Number.parseFloat(node.style.getPropertyValue('--drive-progress')));
    await expect.poll(progress).toBe(0);
    await hero.evaluate((node) => {
      const send = (type: string, screenY: number) => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, 'touches', { value: [{ screenX: 180, screenY }] });
        node.dispatchEvent(event);
      };
      send('touchstart', 520);
      send('touchmove', 75);
    });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(progress).toBeGreaterThan(0.25);
    expect(await progress()).toBeLessThan(0.4);
    await hero.evaluate((node) => node.dispatchEvent(new Event('touchcancel', { bubbles: true })));
    await expect.poll(progress).toBe(0);
  });

  test('native touch sweep follows fast down and up scrolls without waiting for hydration', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/_next/static/**/*.js*', (route) => route.abort());
    await page.goto('/en/');
    test.skip(!await page.evaluate(() => CSS.supports('animation-timeline', 'scroll(root block)')
      && CSS.supports('animation-range', '0px clamp(190px, 72vw, 330px)')), 'Requires native scroll animations.');
    const light = page.getByTestId('hero-road-light');
    const translation = () => light.evaluate((node) =>
      new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
    const scroll = (top: number) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), top);
    await expect.poll(translation).toBeLessThan(-100);
    await scroll(150);
    await expect.poll(translation).toBeGreaterThan(100);
    await scroll(320);
    await expect.poll(translation).toBeGreaterThan(390);
    await scroll(95);
    await expect.poll(translation).toBeLessThan(100);
    await expect.poll(translation).toBeGreaterThan(10);
    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(translation).toBeLessThan(100);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(light).toHaveCSS('opacity', '0');
  });
});

test('vehicle cards rotate in opposite directions across the pointer, reset on leave and retain navigation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/');
  const card = page.locator('[data-home-section^="vehicles-"] article').first();
  await card.scrollIntoViewIfNeeded();
  await page.locator('[data-home-section^="vehicles-"] [tabindex="0"]').first().focus();
  const box = await card.boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.2);
  await expect
    .poll(async () => {
      const { x, y } = await rotation(card);
      return Math.min(Math.abs(x), Math.abs(y));
    })
    .toBeGreaterThan(0.001);
  const first = await rotation(card);
  expect(first.transform).toContain('matrix3d');
  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.8);
  await expect
    .poll(async () => {
      const second = await rotation(card);
      return first.x * second.x < 0 && first.y * second.y < 0;
    })
    .toBe(true);
  await page.mouse.move(5, 100);
  await expectFlat(card);
  const details = card.getByRole('link', { name: 'Details' });
  const href = await details.getAttribute('href');
  await details.click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('main h1')).toBeVisible();
});

test('vehicle tilt stays disabled for touch pointers and reduced-motion users', async ({
  browser,
  baseURL,
}) => {
  for (const touch of [true, false]) {
    const context = await browser.newContext({
      baseURL,
      hasTouch: touch,
      isMobile: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      reducedMotion: touch ? 'no-preference' : 'reduce',
    });
    try {
      const page = await context.newPage();
      await page.goto('/en/');
      const card = page.locator('[data-home-section^="vehicles-"] article').first();
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      if (touch) await card.locator('h3').tap();
      await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.2);
      await page.waitForTimeout(450);
      await expectFlat(card);
    } finally {
      await context.close();
    }
  }
});
