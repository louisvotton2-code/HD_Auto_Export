import { expect, test, type Locator, type Page } from '@playwright/test';

type ArcSample = { x: number; y: number; radius: number; frame: number };
type CanvasProbe = { frames: number; arcs: ArcSample[] };
const probeKey = '__hdHeroMotionProbe';

// Observe actual canvas output without adding a diagnostic API to the shipped component.
async function observeHeroCanvas(page: Page) {
  await page.addInitScript((key) => {
    const probe = { frames: 0, arcs: [] as ArcSample[] };
    Reflect.set(window, key, probe);
    const originalFill = CanvasRenderingContext2D.prototype.fillRect;
    const originalArc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      if (
        this.canvas.dataset.testid === 'hero-ripple-canvas' &&
        x === 0 &&
        y === 0 &&
        width > 100 &&
        height > 100
      )
        probe.frames++;
      return originalFill.call(this, x, y, width, height);
    };
    CanvasRenderingContext2D.prototype.arc = function (x, y, radius, start, end, anticlockwise) {
      if (this.canvas.dataset.testid === 'hero-ripple-canvas' && radius > 12) {
        probe.arcs.push({ x, y, radius, frame: probe.frames });
        if (probe.arcs.length > 15_000) probe.arcs.splice(0, 5000);
      }
      return originalArc.call(this, x, y, radius, start, end, anticlockwise);
    };
  }, probeKey);
}

async function readCanvas(page: Page): Promise<CanvasProbe> {
  return page.evaluate((key) => Reflect.get(window, key) as CanvasProbe, probeKey);
}

function expandingCenters(arcs: ArcSample[]) {
  const centers = new Map<string, Map<number, number>>();
  for (const arc of arcs) {
    const center = `${arc.x.toFixed(2)},${arc.y.toFixed(2)}`;
    const frames = centers.get(center) ?? new Map<number, number>();
    frames.set(arc.frame, Math.max(frames.get(arc.frame) ?? 0, arc.radius));
    centers.set(center, frames);
  }
  return [...centers.entries()].filter(([, frames]) => {
    const radii = [...frames.values()];
    return radii.length >= 6 && radii.at(-1)! - radii[0] > 20;
  });
}

async function waitForHero(page: Page) {
  await page.goto('/en/');
  const canvas = page.getByTestId('hero-ripple-canvas');
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return canvas;
}

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

test('hero waves expand from distinct automatic origins and from the actual pointer position', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeHeroCanvas(page);
  const canvas = await waitForHero(page);
  await expect
    .poll(async () => expandingCenters((await readCanvas(page)).arcs).length, { timeout: 8000 })
    .toBeGreaterThanOrEqual(2);

  const box = await canvas.boundingBox();
  const point = { x: 180, y: Math.round(box!.height * 0.43) };
  await page.evaluate((key) => {
    (Reflect.get(window, key) as CanvasProbe).arcs = [];
  }, probeKey);
  await page.mouse.click(box!.x + point.x, box!.y + point.y);
  await expect
    .poll(async () => {
      const arcs = (await readCanvas(page)).arcs.filter(
        (arc) => Math.abs(arc.x - point.x) < 1 && Math.abs(arc.y - point.y) < 1,
      );
      return expandingCenters(arcs).length;
    })
    .toBe(1);
});

test('hero excludes interactive targets and stops rendering while paused or outside the viewport', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await observeHeroCanvas(page);
  const canvas = await waitForHero(page);
  await expect.poll(async () => (await readCanvas(page)).frames).toBeGreaterThan(2);
  const pause = page.getByRole('button', { name: 'Pause autoplay', exact: true });
  const phone = page.locator('[data-home-section="hero"] a[href^="tel:"]');
  const buttonBox = await phone.boundingBox();
  const canvasBox = await canvas.boundingBox();
  const center = {
    x: buttonBox!.x + buttonBox!.width / 2 - canvasBox!.x,
    y: buttonBox!.y + buttonBox!.height / 2 - canvasBox!.y,
  };
  // Prevent the native tel action while preserving the real bubbling click seen by the hero.
  await phone.evaluate((node) =>
    node.addEventListener('click', (event) => event.preventDefault(), { once: true }),
  );
  await phone.click();
  await page.waitForTimeout(150);
  expect(
    (await readCanvas(page)).arcs.filter(
      (arc) => Math.abs(arc.x - center.x) < 1 && Math.abs(arc.y - center.y) < 1,
    ),
  ).toHaveLength(0);
  await pause.click();
  await expect(page.getByTestId('home-page')).toHaveAttribute('data-motion-paused', 'true');
  await page.waitForTimeout(150);
  const pausedFrames = (await readCanvas(page)).frames;
  await page.waitForTimeout(350);
  expect((await readCanvas(page)).frames).toBe(pausedFrames);
  await page.getByRole('button', { name: 'Resume autoplay', exact: true }).click();
  await expect.poll(async () => (await readCanvas(page)).frames).toBeGreaterThan(pausedFrames);
  await page.locator('[data-home-section="why"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const offscreenFrames = (await readCanvas(page)).frames;
  await page.waitForTimeout(350);
  expect((await readCanvas(page)).frames).toBe(offscreenFrames);
});

test('reduced motion keeps the hero static, including after a click and a preference change', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await observeHeroCanvas(page);
  const canvas = await waitForHero(page);
  await page.waitForTimeout(150);
  const initial = (await readCanvas(page)).frames;
  const box = await canvas.boundingBox();
  await page.mouse.click(box!.x + 180, box!.y + 360);
  await page.waitForTimeout(350);
  expect((await readCanvas(page)).frames).toBe(initial);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await readCanvas(page)).frames).toBeGreaterThan(initial + 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  const reducedFrames = (await readCanvas(page)).frames;
  await page.waitForTimeout(350);
  expect((await readCanvas(page)).frames).toBe(reducedFrames);
});

test('vehicle cards rotate in opposite directions across the pointer, reset on leave and retain navigation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en/');
  await page.getByRole('button', { name: 'Pause autoplay', exact: true }).click();
  const card = page.locator('[data-home-section="vehicles-kia"] article').first();
  await card.scrollIntoViewIfNeeded();
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
      const card = page.locator('[data-home-section="vehicles-kia"] article').first();
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

test('touch waves keep CSS-pixel origins after resize and a scrolled hero at high DPR', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  try {
    await observeHeroCanvas(page);
    const canvas = await waitForHero(page);
    for (const resized of [false, true]) {
      if (resized) {
        await page.setViewportSize({ width: 430, height: 932 });
        await page.evaluate(() => scrollTo({ top: 100, behavior: 'instant' }));
      }
      const box = await canvas.boundingBox();
      const point = { x: 40, y: Math.round(box!.height * 0.6) };
      await page.evaluate((key) => {
        (Reflect.get(window, key) as CanvasProbe).arcs = [];
      }, probeKey);
      await page.touchscreen.tap(box!.x + point.x, box!.y + point.y);
      await expect
        .poll(
          async () =>
            expandingCenters(
              (await readCanvas(page)).arcs.filter(
                (a) => Math.abs(a.x - point.x) < 1 && Math.abs(a.y - point.y) < 1,
              ),
            ).length,
        )
        .toBe(1);
      await expect(canvas).toHaveAttribute('width', String((resized ? 430 : 390) * 2));
    }
  } finally {
    await context.close();
  }
});
