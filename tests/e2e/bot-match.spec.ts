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
  await expect(page.getByRole('button', { name: 'Play against the bot' })).toBeVisible();
});

/** The set-up screen's state as the page reports it. */
function setupState(page: Page): Promise<{ difficulty: string | undefined; bot: string | undefined }> {
  return page.evaluate(() => ({
    difficulty: window.__ttt?.botSetup.difficulty,
    bot: window.__ttt?.botSetup.botPuppet,
  }));
}

test('the bot set-up screen: theme, puppets and difficulty reach the match, survive a rematch and a reload', async ({
  page,
}) => {
  await page.goto(`/?debug=1&autoplay=1&seed=3&tunables=${SHORT}&res=1`);
  await page.getByTestId('play-bot').click();
  const setup = page.getByTestId('bot-setup');
  await expect(setup).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Play against the bot' })).toBeVisible();
  for (const id of ['bot-row-theme', 'bot-row-my-puppet', 'bot-row-bot-puppet', 'bot-row-difficulty']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(setup).toHaveAttribute('data-puppets', 'ready');
  // The defaults: Medium, and the pink sock against the player's teal one.
  await expect(page.getByTestId('bot-difficulty-medium')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-puppet-pink')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-theme-title')).toContainText('Click track');

  await page.getByTestId('bot-difficulty-hard').click();
  await page.getByTestId('bot-puppet-blue').click();
  await expect(page.getByTestId('bot-difficulty-hard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-difficulty-medium')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('bot-puppet-blue')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-puppet-pink')).toHaveAttribute('aria-pressed', 'false');
  expect(await setupState(page)).toEqual({ difficulty: 'hard', bot: 'preset-blue' });
  // The stage now shows the blue sock: give it a moment to draw, then photograph the screen on its own.
  await page.getByTestId('debug-toggle').click();
  await page.mouse.move(640, 450);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/bot-setup.png' });

  // Change the battle theme: the theme screen says where Back goes, and returns here.
  await page.getByTestId('bot-theme-change').click();
  await expect(page.getByTestId('theme-picker')).toBeVisible();
  await expect(page.getByTestId('theme-back')).toHaveText('Back to the set-up');
  await page.getByTestId('theme-back').click();
  await expect(setup).toBeVisible();
  await page.getByTestId('bot-theme-change').click();
  await page.getByTestId('theme-row-placeholder-gallop-152').click();
  await page.getByTestId('done').click();
  await expect(setup).toBeVisible();
  await expect(page.getByTestId('bot-theme-title')).toContainText('Placeholder: Gallop (152)');
  await expect(page.getByTestId('bot-theme-title')).toContainText('152 BPM');
  expect(await setupState(page)).toEqual({ difficulty: 'hard', bot: 'preset-blue' });

  // Start: that theme's tempo, that accuracy, that puppet.
  await page.getByTestId('bot-start').click();
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__ttt?.grid?.bpm)).toBe(152);
  // Hard's fresh parry chance (it tires over the act), read in the count-in.
  expect(await page.evaluate(() => window.__ttt?.bot?.level)).toBe('hard');
  expect(await page.evaluate(() => window.__ttt?.bot?.accuracy)).toBeCloseTo(0.9, 2);
  expect(await page.evaluate(() => window.__ttt?.botPuppetId)).toBe('preset-blue');
  await expect(page.getByTestId('victory')).toBeVisible({ timeout: 100_000 });

  // Rematch: the set-up screen again, everything as it was.
  await page.getByTestId('rematch').click();
  await expect(setup).toBeVisible();
  await expect(page.getByTestId('bot-difficulty-hard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-puppet-blue')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-theme-title')).toContainText('Placeholder: Gallop (152)');

  // And after a reload.
  await page.reload();
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('play-bot').click();
  await expect(setup).toBeVisible();
  await expect(page.getByTestId('bot-difficulty-hard')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-puppet-blue')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('bot-theme-title')).toContainText('Placeholder: Gallop (152)');
  expect(await setupState(page)).toEqual({ difficulty: 'hard', bot: 'preset-blue' });
});

test('the bot set-up screen offers four levels in two rows of two, and Expert starts an Expert bot', async ({
  page,
}) => {
  await page.goto('/?debug=1&bpm=120&res=1');
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('bot-setup')).toHaveAttribute('data-puppets', 'ready');
  const levels = ['easy', 'medium', 'hard', 'expert'] as const;
  const boxes = [];
  for (const d of levels) {
    const b = page.getByTestId(`bot-difficulty-${d}`);
    await expect(b).toBeVisible();
    await expect(b).toHaveText(d[0]!.toUpperCase() + d.slice(1));
    boxes.push(await b.boundingBox());
  }
  const [easy, medium, hard, expert] = boxes;
  // The buttons are torn paper, a little rotated: rows match to within a few pixels.
  expect(Math.abs(easy!.y - medium!.y)).toBeLessThan(6);
  expect(Math.abs(hard!.y - expert!.y)).toBeLessThan(6);
  expect(hard!.y).toBeGreaterThan(easy!.y + easy!.height - 1);
  expect(medium!.x).toBeGreaterThan(easy!.x + easy!.width - 1);
  expect(expert!.x).toBeGreaterThan(hard!.x + hard!.width - 1);
  // The panel clears the Start button.
  const row = await page.getByTestId('bot-row-difficulty').boundingBox();
  const start = await page.getByTestId('bot-start').boundingBox();
  expect(row!.y + row!.height).toBeLessThanOrEqual(start!.y);

  await page.getByTestId('bot-difficulty-expert').click();
  await expect(page.getByTestId('bot-difficulty-expert')).toHaveAttribute('aria-pressed', 'true');
  for (const d of ['easy', 'medium', 'hard']) {
    await expect(page.getByTestId(`bot-difficulty-${d}`)).toHaveAttribute('aria-pressed', 'false');
  }
  await page.getByTestId('debug-toggle').click();
  await page.mouse.move(640, 450);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/bot-setup-expert.png' });
  await page.getByTestId('debug-toggle').click();

  await page.getByTestId('bot-start').click();
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__ttt?.bot?.level)).toBe('expert');
  expect(await page.evaluate(() => window.__ttt?.bot?.accuracy)).toBeCloseTo(0.97, 2);
  expect(await page.evaluate(() => window.__ttt?.bot?.bravoRate)).toBeCloseTo(0.85, 2);
});

for (const level of ['easy', 'expert'] as const) {
  test(`an unattended match against the ${level} bot reaches victory`, async ({ page }) => {
    await page.goto(`/?debug=1&autoplay=1&bpm=180&seed=3&tunables=${SHORT}&res=1`);
    await page.getByTestId('play-bot').click();
    await expect(page.getByTestId('bot-setup')).toHaveAttribute('data-puppets', 'ready');
    await page.getByTestId(`bot-difficulty-${level}`).click();
    await page.getByTestId('bot-start').click();
    await expect(page.getByTestId('banner')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__ttt?.bot?.level)).toBe(level);
    // The bot plants a named pattern in its first attack phrase.
    await expect
      .poll(() => page.evaluate(() => window.__ttt?.bot?.pattern ?? null), { timeout: 60_000 })
      .not.toBeNull();
    await expect(page.getByTestId('victory')).toBeVisible({ timeout: 120_000 });
    const result = await page.evaluate(() => ({
      phase: window.__ttt?.session?.state.phase,
      wins: [...(window.__ttt?.session?.state.actWins ?? [])],
    }));
    expect(result.phase).toBe('matchOver');
    expect(Math.max(...result.wins)).toBe(2);
  });
}

test('Surprise me hides the bot puppet behind a mystery card and is rolled at Start', async ({ page }) => {
  await page.goto('/?debug=1&bpm=120&res=1');
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('bot-setup')).toHaveAttribute('data-puppets', 'ready');
  const card = page.getByTestId('bot-mystery');
  await expect(card).toBeHidden();
  await page.getByTestId('bot-puppet-surprise').click();
  await expect(page.getByTestId('bot-puppet-surprise')).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toBeVisible();
  await expect(card).toContainText('?');
  await expect(page.getByTestId('bot-setup')).toHaveAttribute('data-bot-puppet', 'surprise');
  expect(await page.evaluate(() => window.__ttt?.botPuppetId ?? null)).toBeNull();
  await page.getByTestId('debug-toggle').click();
  await page.mouse.move(640, 450);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/bot-setup-surprise.png' });
  // A named preset takes the card away.
  await page.getByTestId('bot-puppet-blue').click();
  await expect(card).toBeHidden();
  await page.getByTestId('bot-puppet-surprise').click();
  await expect(card).toBeVisible();
  await page.getByTestId('bot-start').click();
  await expect(page.getByTestId('banner')).toBeVisible();
  expect(await page.evaluate(() => window.__ttt?.botPuppetId)).toMatch(/^preset-/);
  expect(await setupState(page)).toEqual({ difficulty: 'medium', bot: 'surprise' });
});

test('the Surprise me card fits a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/?debug=1&bpm=120&res=1');
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('bot-setup')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('bot-puppet-surprise').click();
  await expect(page.getByTestId('bot-mystery')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/screens/bot-setup-surprise-phone.png' });
});

test('Back to title leaves the set-up screen', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('bot-setup')).toBeVisible();
  await page.getByTestId('back-to-title').click();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('bot-setup')).toHaveCount(0);
});

test('with ?bot=1 the first click starts a match without the set-up screen', async ({ page }) => {
  await page.goto('/?debug=1&bot=1&bpm=120');
  await startBot(page);
  await expect(page.getByTestId('bot-setup')).toHaveCount(0);
  // The saved set-up is Medium; ?botAccuracy= overrides it when present.
  expect(await page.evaluate(() => window.__ttt?.bot?.level)).toBe('medium');
  expect(await page.evaluate(() => window.__ttt?.app.match?.bot?.options.accuracy)).toBeCloseTo(0.75, 2);
  await page.goto('/?debug=1&bot=1&bpm=120&botAccuracy=0.4');
  await startBot(page);
  expect(await page.evaluate(() => window.__ttt?.app.match?.bot?.options.accuracy)).toBe(0.4);
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
test('a bot match at 222.22 BPM keeps up and completes an act', async ({ page }) => {
  await page.goto(`/?debug=1&bot=1&autoplay=1&bpm=222.22&seed=3&botAccuracy=0.9&tunables=${SHORT}`);
  await startBot(page);
  await expect.poll(() => page.evaluate(() => window.__ttt?.grid?.bpm)).toBe(222.22);
  await expect
    .poll(() => page.evaluate(() => window.__ttt?.events.some((e) => e.type === 'actOver') ?? false), {
      timeout: 90_000,
    })
    .toBe(true);
  const grades = await page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const e of window.__ttt?.events ?? []) {
      if (e.type === 'judged') counts[e.grade] = (counts[e.grade] ?? 0) + 1;
    }
    return counts;
  });
  expect(Object.values(grades).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__ttt?.grid?.bpm)).toBe(222.22);
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
  // Rematch goes back to the set-up screen; Start plays again.
  await expect(page.getByTestId('bot-setup')).toBeVisible();
  await page.getByTestId('bot-start').click();
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

interface DuelProbe {
  phase: string;
  active: boolean;
  slot: number;
  strikes: number;
  resolved: number;
  pending: number;
}

function probe(page: Page): Promise<DuelProbe | null> {
  return page.evaluate(() => {
    const v = window.__ttt?.session?.view();
    if (!v) return null;
    return {
      phase: v.phase,
      active: v.localActive,
      slot: v.slotPosition,
      strikes: v.strikes.length,
      resolved: v.targets.filter((t) => t.result !== null).length,
      pending: v.targets.filter((t) => t.result === null && t.timeToHit > 0).length,
    };
  });
}

test('final design: title and duel screenshots', async ({ page }) => {
  await page.goto('/?debug=1&res=1');
  await expect(page.getByTestId('title')).toBeVisible();
  // The puppets load a moment after the sign: the photograph waits for both to stand on the stage.
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('debug-toggle').click();
  await page.mouse.move(640, 330);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/screens/final-title.png' });

  await page.goto('/?debug=1&bot=1&autoplay=1&bpm=100&seed=3&botAccuracy=0.9&res=1');
  await startBot(page);
  // The debug panel is collapsible so the stage can be photographed on its own.
  await page.getByTestId('debug-toggle').click();

  // Reaching for the middle of the stage: the local sword tip follows the pointer.
  await page.mouse.move(820, 300);
  let attack = false;
  let defend = false;
  const deadline = Date.now() + 60_000;
  while (!(attack && defend)) {
    if (Date.now() > deadline) throw new Error('never saw both duel moments');
    const p = await probe(page);
    if (p && !attack && p.phase === 'attack' && p.active && p.strikes >= 3 && p.slot >= 5 && p.slot <= 6.5) {
      attack = true;
      await page.screenshot({ path: 'test-results/screens/final-duel-attack.png' });
    } else if (p && !defend && p.phase === 'defend' && p.active && p.resolved >= 1 && p.pending >= 2) {
      defend = true;
      await page.screenshot({ path: 'test-results/screens/final-duel-defend.png' });
    }
    await page.waitForTimeout(25);
  }
  // Both HUD parts were readable while the duel ran.
  await expect(page.getByTestId('banner')).toBeVisible();
});

interface TurnProbe {
  phase: string;
  local: number;
  active: boolean;
  slot: number;
  strikes: number;
  pending: number;
  turn: [string | null, string | null];
  line: string | null;
  caption: string | null;
}

function turnProbe(page: Page): Promise<TurnProbe | null> {
  return page.evaluate(() => {
    const v = window.__ttt?.session?.view();
    if (!v) return null;
    const val = (id: string): string | null =>
      document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-value') ?? null;
    return {
      phase: v.phase,
      local: v.localPlayer,
      active: v.localActive,
      slot: v.slotPosition,
      strikes: v.strikes.length,
      pending: v.targets.filter((t) => t.result === null && t.timeToHit > 0).length,
      turn: [val('turn-0'), val('turn-1')],
      line: document.querySelector('[data-testid="turn-line"]')?.textContent ?? null,
      caption: document.querySelector('.hud-dots-caption')?.textContent ?? null,
    };
  });
}

test('whose turn it is is shown before and during a round', async ({ page }) => {
  await page.goto('/?debug=1&bot=1&autoplay=1&bpm=100&seed=3&botAccuracy=0.9&res=1');
  await startBot(page);
  await page.getByTestId('debug-toggle').click();

  // Count-in: both plates are waiting, and a line says who attacks first.
  await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'countIn');
  await expect(page.getByTestId('turn-0')).toHaveAttribute('data-value', 'waiting');
  await expect(page.getByTestId('turn-1')).toHaveAttribute('data-value', 'waiting');
  await expect(page.getByTestId('turn-line')).toHaveText(/ attacks? first$/);
  await page.mouse.move(820, 300);
  await page.screenshot({ path: 'test-results/screens/turns-countin.png' });

  let attack = false;
  let parry = false;
  const deadline = Date.now() + 80_000;
  while (!(attack && parry)) {
    if (Date.now() > deadline) throw new Error('never saw both the local attack and the local parry');
    const p = await turnProbe(page);
    if (p && !attack && p.phase === 'attack' && p.active && p.strikes >= 3 && p.slot >= 5 && p.slot <= 6.5) {
      attack = true;
      expect(p.turn[p.local]).toBe('attacking');
      expect(p.turn[1 - p.local]).toBe('watching');
      await page.screenshot({ path: 'test-results/screens/turns-attack.png' });
    } else if (p && !parry && p.phase === 'defend' && p.active && p.slot >= 1 && p.pending >= 2) {
      parry = true;
      expect(p.turn[p.local]).toBe('parrying');
      expect(p.turn[1 - p.local]).toBe('watching');
      await page.screenshot({ path: 'test-results/screens/turns-parry.png' });
    }
    await page.waitForTimeout(25);
  }
  await expect(page.getByTestId('swatch-0')).toBeVisible();
  await expect(page.getByTestId('swatch-1')).toBeVisible();
});
