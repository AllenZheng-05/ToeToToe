import { expect, test as base, type Page } from '@playwright/test';

/** Chromium's software GL driver note while PixiJS starts; see bot-match.spec.ts. */
const IGNORED = /GL Driver Message .*GPU stall due to ReadPixels/;

type Opener = (url: string) => Promise<Page>;

/** Pages open in one context (BroadcastChannel needs it). Console errors, warnings and page errors on any fail the test. */
const test = base.extend<{ open: Opener; problems: string[] }>({
  problems: [
    async ({ browserName: _browser }, use) => {
      const problems: string[] = [];
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
  open: async ({ context, problems }, use) => {
    const open: Opener = async (url) => {
      const page = await context.newPage();
      const tag = `page ${context.pages().length}`;
      page.on('console', (m) => {
        if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED.test(m.text()))
          problems.push(`${tag} ${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
      await page.goto(url);
      return page;
    };
    await use(open);
  },
});

const SHORT = encodeURIComponent(JSON.stringify({ startHealth: 30 }));
const HOST_QUERY = `net=tab&debug=1&bpm=140&tunables=${SHORT}`;
const PLAIN_QUERY = 'net=tab&debug=1';

interface Room {
  A: Page;
  B: Page;
  code: string;
}

async function createRoom(open: Opener, query: string, name = 'Ada'): Promise<{ A: Page; code: string }> {
  const A = await open(`/?${query}`);
  await A.getByTestId('name-input').fill(name);
  await A.getByRole('button', { name: 'Create a room', exact: true }).click();
  await expect(A.getByTestId('lobby')).toBeVisible();
  const code = (await A.getByTestId('room-code').textContent()) ?? '';
  expect(code).toMatch(/^[A-Z]{3}-[A-Z]-\d\d$/);
  return { A, code };
}

async function joinByLink(open: Opener, code: string, name: string): Promise<Page> {
  const B = await open(`/${code}?${PLAIN_QUERY}`);
  await B.getByTestId('name-input').fill(name);
  await B.getByRole('button', { name: `Join room ${code}`, exact: true }).click();
  await expect(B.getByTestId('lobby')).toBeVisible();
  return B;
}

async function pairedRoom(open: Opener, hostQuery = HOST_QUERY): Promise<Room> {
  const { A, code } = await createRoom(open, hostQuery);
  const B = await joinByLink(open, code, 'Bo');
  await expect(A.getByTestId('player-1-name')).toContainText('Bo');
  await expect(B.getByTestId('player-0-name')).toContainText('Ada');
  return { A, B, code };
}

/** Both ready, host starts, and both pages are in the duel. */
async function startMatch({ A, B }: Room): Promise<void> {
  await B.getByTestId('ready-toggle').click();
  await A.getByTestId('ready-toggle').click();
  await expect(A.getByTestId('start')).toBeEnabled();
  await expect(B.getByTestId('player-0-ready')).toHaveText('Ready');
  await A.getByTestId('start').click();
  for (const page of [A, B]) {
    await expect(page.getByTestId('banner')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__ttt?.grid !== null)).toBe(true);
  }
}

interface Click {
  phrase: number;
  slot: number;
  x: number;
  y: number;
}

const script = (page: Page, events: Click[]): Promise<void> =>
  page.evaluate((e) => window.__ttt?.script(e), events);

const stateJson = (page: Page): Promise<string> =>
  page.evaluate(() => JSON.stringify(window.__ttt?.session?.state ?? null));

const eventTypes = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window.__ttt?.events ?? []).map((e) => e.type));

/** Strike positions shared by attacker plants and defender parries. */
const P = {
  a: { x: 0.3, y: 0.4 },
  b: { x: 0.6, y: 0.5 },
  c: { x: 0.5, y: 0.3 },
  d: { x: 0.7, y: 0.6 },
  e: { x: 0.2, y: 0.3 },
  f: { x: 0.8, y: 0.4 },
};

/**
 * Act 1 of the match, first attacker = host (player 0), first phrase = 1:
 * turn 1 host plants 2, guest parries one; turn 2 guest plants 2, host parries both;
 * turn 3 host plants 3, guest parries one, which takes the guest to 0.
 */
async function scriptActOne({ A, B }: Room): Promise<void> {
  await script(A, [
    { phrase: 1, slot: 1, ...P.a },
    { phrase: 1, slot: 3, ...P.b },
    { phrase: 4, slot: 2, ...P.c },
    { phrase: 4, slot: 4, ...P.d },
    { phrase: 5, slot: 1, ...P.e },
    { phrase: 5, slot: 3, ...P.b },
    { phrase: 5, slot: 5, ...P.f },
  ]);
  await script(B, [
    { phrase: 2, slot: 1, ...P.a },
    { phrase: 3, slot: 2, ...P.c },
    { phrase: 3, slot: 4, ...P.d },
    { phrase: 6, slot: 1, ...P.e },
  ]);
}

async function waitForActOver(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    await expect
      .poll(async () => (await eventTypes(page)).includes('actOver'), { timeout: 60_000 })
      .toBe(true);
  }
}

test('a room flow: create, join by link, and a third page is turned away', async ({ open }) => {
  const { A, code } = await createRoom(open, PLAIN_QUERY);
  await expect(A.getByTestId('status')).toHaveText('Waiting for a friend to join');
  expect(new URL(A.url()).pathname).toBe(`/${code}`);
  expect(new URL(A.url()).search).toBe(`?${PLAIN_QUERY}`);
  await expect(A.getByTestId('share-link')).toHaveValue(new RegExp(`/${code}$`));

  const B = await joinByLink(open, code, 'Bo');
  await expect(A.getByTestId('player-1-name')).toContainText('Bo');
  await expect(B.getByTestId('player-0-name')).toContainText('Ada');
  await expect(A.getByTestId('player-0-name')).toContainText('Ada');
  await expect(B.getByTestId('player-1-name')).toContainText('Bo');
  await expect(A.getByTestId('status')).toHaveText('Bo joined');
  await expect(B.getByTestId('rtt')).toContainText('Round trip');

  // Ready states travel both ways, and only the host can start.
  await expect(B.getByTestId('start')).toBeHidden();
  await expect(A.getByTestId('start')).toBeDisabled();
  await B.getByTestId('ready-toggle').click();
  await expect(A.getByTestId('player-1-ready')).toHaveText('Ready');
  await expect(A.getByTestId('start')).toBeDisabled();
  await A.getByTestId('ready-toggle').click();
  await expect(A.getByTestId('start')).toBeEnabled();
  await A.screenshot({ path: 'test-results/screens/lobby-host.png' });
  await B.screenshot({ path: 'test-results/screens/lobby-guest.png' });

  const C = await joinByLink(open, code, 'Cy');
  await expect(C.getByTestId('status')).toHaveText('This room is full');
  await expect(C.getByTestId('back-to-title')).toBeVisible();
  await C.screenshot({ path: 'test-results/screens/lobby-full.png' });
  await C.close();

  // The first two are undisturbed.
  await expect(A.getByTestId('status')).toHaveText('Bo joined');
  await expect(B.getByTestId('status')).toContainText("Joined Ada's room");
  await expect(A.getByTestId('start')).toBeEnabled();
  await expect(A.getByTestId('player-1-name')).toContainText('Bo');
});

test('the title checks room codes', async ({ open }) => {
  const A = await open(`/?${PLAIN_QUERY}`);
  await A.getByRole('button', { name: 'Join a room', exact: true }).click();
  await A.getByTestId('join-code').fill('nonsense');
  await A.getByTestId('join-go').click();
  await expect(A.getByTestId('join-error')).toHaveText("That doesn't look like a room code.");
  await expect(A.getByTestId('lobby')).toHaveCount(0);
  // Spaces and lower case are fine.
  await A.getByTestId('join-code').fill('row g 12');
  await A.getByTestId('join-go').click();
  await expect(A.getByTestId('lobby')).toBeVisible();
  await expect(A.getByTestId('room-code')).toHaveText('ROW-G-12');
  expect(new URL(A.url()).pathname).toBe('/ROW-G-12');
  await expect(A.getByTestId('status')).toHaveText('Waiting for the host');
  await A.getByTestId('leave').click();
  await expect(A.getByTestId('title')).toBeVisible();
  expect(new URL(A.url()).pathname).toBe('/');
});

test('a full scripted act is judged the same on both pages', async ({ open }) => {
  const room = await pairedRoom(open);
  const { A, B } = room;
  await startMatch(room);

  // The guest adopted the host's tempo and tunables.
  for (const page of [A, B]) {
    expect(await page.evaluate(() => window.__ttt?.grid?.bpm)).toBe(140);
    expect(await page.evaluate(() => window.__ttt?.app.tunables.startHealth)).toBe(30);
  }
  await scriptActOne(room);

  // Mid-duel pictures: after the first strikes have been parried.
  for (const page of [A, B]) {
    await expect
      .poll(() => page.evaluate(() => window.__ttt?.session?.state.phrase ?? 0), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
  }
  await A.screenshot({ path: 'test-results/screens/two-window-host.png' });
  await B.screenshot({ path: 'test-results/screens/two-window-guest.png' });

  await waitForActOver(A, B);
  for (const page of [A, B]) {
    const result = await page.evaluate(() => {
      const t = window.__ttt;
      const over = t?.events.find((e) => e.type === 'actOver');
      return {
        over: over && over.type === 'actOver' ? { winner: over.winner, act: over.act } : null,
        actWins: t?.session ? [...t.session.state.actWins] : null,
        lastHealth: t?.healthLog[t.healthLog.length - 1]?.health ?? null,
        actOvers: t?.events.filter((e) => e.type === 'actOver').length,
      };
    });
    expect(result.over).toEqual({ winner: 0, act: 0 });
    expect(result.actWins).toEqual([1, 0]);
    expect(result.lastHealth).toEqual([30, 0]);
    expect(result.actOvers).toBe(1);
  }

  // A quiet moment: the intermission between acts.
  await A.waitForTimeout(500);
  const [stateA, stateB] = await Promise.all([stateJson(A), stateJson(B)]);
  expect(stateA).not.toBe('null');
  expect(stateA).toBe(stateB);
  for (const page of [A, B]) expect(await eventTypes(page)).not.toContain('desync');
});

test('a whole match ends the same on both pages, and a rematch flips the first attacker', async ({
  open,
}) => {
  const room = await pairedRoom(open);
  const { A, B } = room;
  await startMatch(room);
  await scriptActOne(room);
  await waitForActOver(A, B);

  // Act 2: the guest attacks first (phrase 10), then the host plants three strikes the guest ignores.
  await script(B, [{ phrase: 10, slot: 1, ...P.a }]);
  await script(A, [
    { phrase: 11, slot: 1, ...P.a },
    { phrase: 12, slot: 1, ...P.e },
    { phrase: 12, slot: 3, ...P.b },
    { phrase: 12, slot: 5, ...P.f },
  ]);

  for (const page of [A, B]) {
    await expect(page.getByTestId('victory')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('winner')).toHaveText('ADA WINS!');
    await expect(page.getByTestId('score')).toHaveText('Acts: Ada 2, Bo 0');
    expect(await eventTypes(page)).not.toContain('desync');
  }
  await A.screenshot({ path: 'test-results/screens/two-window-victory.png' });

  // Rematch: A asks first.
  await A.getByTestId('rematch').click();
  await expect(A.getByTestId('rematch-status')).toHaveText('Waiting for your friend…');
  await expect(B.getByTestId('rematch-status')).toHaveText('Ada wants a rematch');
  await B.getByTestId('rematch').click();
  for (const page of [A, B]) {
    await expect(page.getByTestId('victory')).toHaveCount(0);
    await expect(page.getByTestId('banner')).toHaveAttribute('data-phase', 'countIn');
    await expect.poll(() => page.evaluate(() => window.__ttt?.app.match?.firstAttacker)).toBe(1);
    expect(await page.evaluate(() => window.__ttt?.session?.state.attacker)).toBe(1);
    expect(await page.evaluate(() => window.__ttt?.session?.state.actWins)).toEqual([0, 0]);
    await expect(page.getByTestId('health-0')).toHaveAttribute('data-value', '30');
  }
});

test('the host sees "Your friend left" when the guest closes mid-lobby', async ({ open }) => {
  const { A, B } = await pairedRoom(open, PLAIN_QUERY);
  await B.close({ runBeforeUnload: true });
  await expect(A.getByText('Your friend left')).toBeVisible();
  await expect(A.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  expect(new URL(A.url()).pathname).toBe('/');
});

test('the host sees "Your friend left" when the guest closes mid-duel', async ({ open }) => {
  const room = await pairedRoom(open);
  const { A, B } = room;
  await startMatch(room);
  await B.close({ runBeforeUnload: true });
  await expect(A.getByText('Your friend left')).toBeVisible();
  await expect(A.getByTestId('title')).toBeVisible({ timeout: 10_000 });
  expect(new URL(A.url()).pathname).toBe('/');
});
