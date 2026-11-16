import { expect, test as base } from '@playwright/test';

/** The input calibration screen: taps against the click, the result, and the offset reaching a match. */

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

test('calibration measures late taps, stores the offset and uses it in a match', async ({ page }) => {
  await page.goto('/?debug=1&bpm=120&res=1');
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('open-calibration').click();
  const scene = page.getByTestId('calibration');
  await expect(scene).toHaveAttribute('data-state', 'running');

  // Nine taps a little after each click. The page records how late each one really was on the audio
  // clock (a busy software renderer adds some), so the screen's answer can be checked exactly.
  const measured = await page.evaluate(async () => {
    const app = window.__ttt?.app;
    const root = document.querySelector<HTMLElement>('[data-testid="calibration"]');
    const target = document.querySelector<HTMLElement>('[data-testid="calibration-target"]');
    if (!app || !root || !target) throw new Error('calibration screen missing');
    const start = Number(root.dataset.start);
    const beat = 60 / Number(root.dataset.bpm);
    const errors: number[] = [];
    for (let k = 3; k < 12; k++) {
      const due = start + k * beat + 0.04;
      while (app.engine.clock.now() < due) await new Promise((r) => setTimeout(r, 1));
      const ev = new PointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        pointerType: 'mouse',
        button: 0,
      });
      const heard = app.engine.clock.timeOfEvent(ev.timeStamp);
      target.dispatchEvent(ev);
      errors.push((heard - start - k * beat) * 1000);
    }
    return errors;
  });
  const expected = measured.reduce((a, b) => a + b, 0) / measured.length;
  expect(expected).toBeGreaterThan(20); // late, as intended

  const result = page.getByTestId('calibration-result');
  await expect(result).toContainText('late');
  const shown = Number(await result.getAttribute('data-mean'));
  expect(Math.abs(shown - expected)).toBeLessThan(2);

  // Use this stores the rounded mean; the fine buttons and Reset change it.
  await page.getByTestId('calibration-use').click();
  const stored = (): Promise<number | undefined> => page.evaluate(() => window.__ttt?.app.inputOffsetMs);
  expect(await stored()).toBe(shown);
  await page.getByTestId('calibration-plus').click();
  expect(await stored()).toBe(shown + 5);
  await page.getByTestId('calibration-minus').click();
  await page.getByTestId('calibration-minus').click();
  expect(await stored()).toBe(shown - 5);
  await page.getByTestId('calibration-use').click();
  await expect(page.getByTestId('calibration-stored')).toContainText(`${shown}`);

  // It is kept across a reload, and the next match uses it.
  await page.getByTestId('calibration-done').click();
  await expect(page.getByTestId('title')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  expect(await stored()).toBe(shown);
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('banner')).toBeVisible();
  expect(await page.evaluate(() => window.__ttt?.session?.inputOffsetMs)).toBe(shown);
  await expect(page.locator('.dbg-val').filter({ hasText: `set ${shown} ms` })).toHaveCount(1);

  // Reset to 0 is on the calibration screen: go back and use it.
  await page.reload();
  await page.getByTestId('open-calibration').click();
  await page.getByTestId('calibration-reset').click();
  expect(await stored()).toBe(0);
});
