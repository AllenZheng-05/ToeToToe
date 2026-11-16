import { expect, test as base, type Page } from '@playwright/test';

/** A landscape phone with touch: the whole title-to-victory path is played with taps. */

const IGNORED = /GL Driver Message .*GPU stall due to ReadPixels/;

const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED.test(m.text()))
          problems.push(`${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

test.use({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

const SHORT = encodeURIComponent(JSON.stringify({ startHealth: 12, actDurationSec: 10, actsToWin: 1 }));

interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const fitOf = (page: Page): Promise<Fit> => page.evaluate(() => window.__ttt?.app.stage.fit as Fit);

/** Every button and field on screen is at least 44 CSS px tall once the stage is scaled, and inside the window. */
async function expectTouchSized(page: Page, scope: string): Promise<void> {
  const report = await page.evaluate((sel) => {
    const scale = window.__ttt?.app.stage.fit.scale ?? 1;
    const out: { name: string; heightPx: number; inside: boolean }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} input`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden
      // The laid-out height in design px times the scale: rotation of a torn button does not count.
      const heightPx = Number.parseFloat(getComputedStyle(el).height) * scale;
      const inside =
        r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
      out.push({ name: el.dataset.testid ?? el.textContent ?? el.tagName, heightPx, inside });
    }
    return out;
  }, scope);
  expect(report.length).toBeGreaterThan(0);
  for (const c of report) {
    expect(c.heightPx, `${c.name} height`).toBeGreaterThanOrEqual(43.5);
    expect(c.inside, `${c.name} inside the window`).toBe(true);
  }
}

async function expectNoScrollbars(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  expect(size.sw).toBeLessThanOrEqual(size.w);
  expect(size.sh).toBeLessThanOrEqual(size.h);
}

test('the title fits a phone, buttons are tap-sized, and the other menu screens too', async ({ page }) => {
  await page.goto('/?debug=1&res=1&net=tab');
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
  await expectNoScrollbars(page);
  await expectTouchSized(page, '[data-testid="title"]');
  // The debug panel is out of the way for the photographs.
  await page.getByTestId('debug-toggle').tap();
  await page.screenshot({ path: 'test-results/screens/phone-title.png' });

  await page.getByTestId('open-calibration').tap();
  await expect(page.getByTestId('calibration')).toHaveAttribute('data-state', 'running');
  await expectTouchSized(page, '[data-testid="calibration"]');
  await page.screenshot({ path: 'test-results/screens/phone-calibration.png' });
  await page.getByTestId('calibration-done').tap();

  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByTestId('create-room').tap();
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expectTouchSized(page, '[data-testid="lobby"]');
  await expectNoScrollbars(page);
  await page.screenshot({ path: 'test-results/screens/phone-lobby.png' });
});

test('a tap starts a bot match and a tap plants a strike', async ({ page }) => {
  await page.goto('/?debug=1&bot=1&bpm=120&botAccuracy=1&res=1');
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  // ?bot=1 starts the match on the first tap anywhere; the button is the normal way.
  await page.getByTestId('play-bot').tap();
  await expect(page.getByTestId('banner')).toBeVisible();
  await page.getByTestId('debug-toggle').tap();
  await expect(page.getByTestId('banner')).toHaveAttribute('data-value', 'ATTACK!', { timeout: 30_000 });

  const fit = await fitOf(page);
  const at = (fx: number, fy: number): { x: number; y: number } => ({
    x: fit.offsetX + (200 + fx * 880) * fit.scale,
    y: fit.offsetY + (163 + fy * 440) * fit.scale,
  });
  const staminaBefore = Number(await page.getByTestId('stamina-0').getAttribute('data-value'));
  for (const [fx, fy] of [
    [0.3, 0.4],
    [0.6, 0.5],
    [0.5, 0.3],
  ] as const) {
    const p = at(fx, fy);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(250);
  }
  const strikes = await page.evaluate(() => window.__ttt?.session?.state.strikes ?? []);
  expect(strikes.length).toBeGreaterThan(0);
  // The strike is where the finger landed (play-area fractions).
  const first = strikes[0];
  const want = [
    [0.3, 0.4],
    [0.6, 0.5],
    [0.5, 0.3],
  ].some(
    ([fx, fy]) =>
      Math.abs((first?.x ?? 9) - (fx as number)) < 0.03 && Math.abs((first?.y ?? 9) - (fy as number)) < 0.03,
  );
  expect(want).toBe(true);
  expect(Number(await page.getByTestId('stamina-0').getAttribute('data-value'))).toBeLessThan(staminaBefore);
  await page.screenshot({ path: 'test-results/screens/phone-duel.png' });
});

test('a phone match autoplays to victory', async ({ page }) => {
  await page.goto(`/?debug=1&bot=1&autoplay=1&bpm=180&seed=3&botAccuracy=0.4&tunables=${SHORT}&res=1`);
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('play-bot').tap();
  await expect(page.getByTestId('victory')).toBeVisible({ timeout: 100_000 });
  await expectTouchSized(page, '[data-testid="victory"]');
  await page.screenshot({ path: 'test-results/screens/phone-victory.png' });
});

test('in portrait the rotate prompt covers the game', async ({ page }) => {
  await page.goto('/?res=1');
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  const prompt = page.getByTestId('rotate-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Turn your phone sideways');
  await page.screenshot({ path: 'test-results/screens/phone-rotate.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(prompt).toBeHidden();
});
