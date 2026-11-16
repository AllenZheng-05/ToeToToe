import { expect, test as base, type Page } from '@playwright/test';

/**
 * Collects console errors, warnings and uncaught page errors; the test fails if any occurred.
 * The one allow-listed message is Chromium's GL driver performance note "GPU stall due to ReadPixels":
 * the software GL backend of headless Chromium emits it while PixiJS initialises its renderer,
 * it is not an error in the app, and it does not appear with a hardware GPU.
 */
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

const SHORT = encodeURIComponent(JSON.stringify({ startHealth: 30, actDurationSec: 20 }));
const FAST_MATCH = `/?debug=1&bot=1&autoplay=1&bpm=180&seed=3&botAccuracy=0.4&tunables=${SHORT}`;

async function startBot(page: Page): Promise<void> {
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('banner')).toBeVisible();
}

interface Sample {
  victory: boolean;
  banner: string | null;
  health: [string | null, string | null];
}

/** One read of the page that never waits for an element (scenes swap while the match ends). */
function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const val = (id: string): string | null =>
      document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-value') ?? null;
    return {
      victory: document.querySelector('[data-testid="victory"]') !== null,
      banner: val('banner'),
      health: [val('health-0'), val('health-1')],
    };
  });
}

/** Starts the bot match from the title and samples the HUD until the victory screen shows. */
async function playToVictory(page: Page): Promise<{ banners: Set<string>; health: Set<string> }> {
  await startBot(page);
  const banners = new Set<string>();
  const health = new Set<string>();
  let shot = false;
  const deadline = Date.now() + 100_000;
  for (;;) {
    const s = await sample(page);
    if (s.victory) break;
    if (Date.now() > deadline) throw new Error('match did not reach the victory screen in time');
    if (s.banner) banners.add(s.banner);
    s.health.forEach((v, i) => v !== null && health.add(`${i}=${v}`));
    if (!shot && banners.has('ATTACK!') && banners.has('PARRY!') && health.size > 2) {
      shot = true;
      await page.screenshot({ path: 'test-results/screens/bot-duel.png' });
    }
    await page.waitForTimeout(40);
  }
  return { banners, health };
}

test('title loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Toe to Toe' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a room', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join a room', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Practise against the bot' })).toBeVisible();
});

test('a bot match runs to victory unattended', async ({ page }) => {
  await page.goto(FAST_MATCH);
  const { banners, health } = await playToVictory(page);
  await page.screenshot({ path: 'test-results/screens/bot-victory.png' });

  expect([...banners].some((b) => /^\d+$/.test(b))).toBe(true); // count-in
  expect(banners.has('ATTACK!')).toBe(true);
  expect(banners.has('PARRY!')).toBe(true);
  expect(banners.has('WATCH')).toBe(true);
  expect([...health].filter((s) => s.startsWith('0=')).length).toBeGreaterThan(1);
  await expect(page.getByTestId('winner')).toHaveText(/ WINS!$/);

  const result = await page.evaluate(() => {
    const s = window.__ttt?.session;
    return s ? { phase: s.state.phase, actWins: [...s.state.actWins] } : null;
  });
  expect(result?.phase).toBe('matchOver');
  expect(result?.actWins).toContain(2);
});
test('a human click plants a strike', async ({ page }) => {
  await page.goto('/?debug=1&bot=1&bpm=120&botAccuracy=1');
  await startBot(page);
  await expect(page.getByTestId('banner')).toHaveAttribute('data-value', 'ATTACK!', { timeout: 30_000 });
  const staminaBefore = Number(await page.getByTestId('stamina-0').getAttribute('data-value'));
  // The play area is design rect x 200..1080, y 163..603 on a 1280x720 viewport.
  const points = [
    [400, 300],
    [600, 400],
    [800, 350],
  ] as const;
  for (const [x, y] of points) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  }
  const strikes = await page.evaluate(() => window.__ttt?.session?.state.strikes.length ?? 0);
  expect(strikes).toBeGreaterThan(0);
  const staminaAfter = Number(await page.getByTestId('stamina-0').getAttribute('data-value'));
  expect(staminaAfter).toBeLessThan(staminaBefore);
});

test('rematch starts a fresh match', async ({ page }) => {
  await page.goto(FAST_MATCH);
  await playToVictory(page);
  await page.getByTestId('rematch').click();
  await expect(page.getByTestId('victory')).toHaveCount(0);
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'countIn');
  await expect(page.getByTestId('health-0')).toHaveAttribute('data-value', '30');
  await expect(page.getByTestId('health-1')).toHaveAttribute('data-value', '30');
});

test('debug overlay shows the beat and edits tunables', async ({ page }) => {
  await page.goto('/?debug=1&bot=1&bpm=120');
  await startBot(page);
  const overlay = page.getByTestId('debug-overlay');
  await expect(overlay).toBeVisible();
  const beatRow = overlay.locator('.dbg-val').first();
  const first = await beatRow.textContent();
  await expect.poll(async () => beatRow.textContent()).not.toBe(first);

  const keys = await page.evaluate(() => Object.keys(window.__ttt!.app.tunables));
  for (const key of keys) await expect(page.getByTestId(`tunable-${key}`)).toHaveCount(1);

  const input = page.getByTestId('tunable-missDamage');
  await input.fill('17');
  expect(await page.evaluate(() => window.__ttt?.app.tunables.missDamage)).toBe(17);
});
