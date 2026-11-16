import { readFileSync } from 'node:fs';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

/**
 * The built site under the exact headers of public/_headers, applied to every response so Chromium really
 * enforces the Content-Security-Policy. Any securitypolicyviolation event, console error or warning, or
 * page error fails the test.
 */

const IGNORED = /GL Driver Message .*GPU stall due to ReadPixels/;

interface HeaderBlock {
  path: string;
  headers: Record<string, string>;
}

/** Parses Cloudflare's _headers format: unindented path lines, indented "Name: value" lines. */
function parseHeaders(text: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    if (/^\S/.test(raw)) {
      blocks.push({ path: raw.trim(), headers: {} });
      continue;
    }
    const block = blocks[blocks.length - 1];
    const at = raw.indexOf(':');
    if (!block || at < 0) continue;
    block.headers[raw.slice(0, at).trim().toLowerCase()] = raw.slice(at + 1).trim();
  }
  return blocks;
}

function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

const BLOCKS = parseHeaders(readFileSync('public/_headers', 'utf8'));
const POLICY = BLOCKS.find((b) => b.path === '/*')?.headers['content-security-policy'] ?? '';

/** Every response of the site carries the headers of the blocks that match its path. */
async function enforceHeaders(context: BrowserContext, origin: string): Promise<void> {
  await context.route(`${origin}/**`, async (route) => {
    const response = await route.fetch();
    const { pathname } = new URL(route.request().url());
    const headers: Record<string, string> = { ...response.headers() };
    for (const block of BLOCKS) if (pathMatches(block.path, pathname)) Object.assign(headers, block.headers);
    await route.fulfill({ response, headers });
  });
}

const COLLECT = `
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push(e.violatedDirective + ' blocked ' + e.blockedURI + ' at ' + e.sourceFile + ' ' + e.sample);
  });
`;

type Opener = (url: string) => Promise<Page>;

const test = base.extend<{ open: Opener; problems: string[] }>({
  problems: [
    async ({ browserName: _browser }, use) => {
      const problems: string[] = [];
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
  open: async ({ context, baseURL, problems }, use) => {
    await enforceHeaders(context, new URL(baseURL ?? 'http://localhost:4173').origin);
    await context.addInitScript(COLLECT);
    const pages: Page[] = [];
    await use(async (url) => {
      const page = await context.newPage();
      pages.push(page);
      const tag = `page ${pages.length}`;
      page.on('console', (m) => {
        if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED.test(m.text()))
          problems.push(`${tag} ${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
      const response = await page.goto(url);
      // The policy must really be on the document, or this whole spec proves nothing.
      expect(response?.headers()['content-security-policy']).toBe(POLICY);
      return page;
    });
    for (const page of pages) {
      const found = await page
        .evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)
        .catch(() => []);
      problems.push(...found.map((v) => `csp violation: ${v}`));
    }
  },
});

/** A mono 16-bit WAV with a kick drum on every beat of a steady tempo. */
function kickTrackWav(bpm: number, seconds: number): Buffer {
  const rate = 44_100;
  const n = Math.floor(rate * seconds);
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(n * 2, 40);
  const beat = (60 / bpm) * rate;
  for (let i = 0; i < n; i++) {
    // A kick drum: a falling sine with a burst of noise at the start, ringing out in a quarter second.
    const t = (i % beat) / rate;
    const body =
      t < 0.25 ? Math.exp(-t / 0.05) * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-t / 0.02)) * t) : 0;
    const noise = t < 0.02 ? (((i * 48271) % 2147483647) / 2147483647 - 0.5) * 0.5 : 0;
    const v = Math.max(-1, Math.min(1, body * 0.9 + noise));
    pcm.writeInt16LE(Math.round(v * 30_000), 44 + i * 2);
  }
  return pcm;
}

test('the policy is the one in public/_headers', () => {
  expect(POLICY).toContain("default-src 'none'");
  expect(POLICY).toContain("script-src 'self'");
});

test('the policy really is enforced in the browser', async ({ open, problems }) => {
  const page = await open('/');
  // An inline style attribute is something the policy forbids: the browser must report it.
  await page.evaluate(() => document.body.setAttribute('style', 'color: red'));
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations.join('|')),
    )
    .toContain('style-src-attr');
  // That was on purpose: forget it so the checks at the end of the test pass.
  problems.length = 0;
  await page.evaluate(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations.length = 0;
  });
});

test('title, fonts and stage load, and a bot match runs to victory', async ({ open }) => {
  const short = encodeURIComponent(JSON.stringify({ startHealth: 12, actDurationSec: 10, actsToWin: 1 }));
  const page = await open(`/?debug=1&bot=1&autoplay=1&bpm=180&seed=3&botAccuracy=0.4&tunables=${short}`);
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  const fonts = await page.evaluate(
    () => document.fonts.check('20px Bungee') && document.fonts.check("20px 'Special Elite'"),
  );
  expect(fonts).toBe(true);
  expect(await page.locator('canvas.stage-canvas').count()).toBe(1);
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect(page.getByTestId('victory')).toBeVisible({ timeout: 100_000 });
  await expect(page.getByTestId('winner')).toHaveText(/ WINS!$/);
});

test('the bot set-up screen works under the policy and starts a match', async ({ open }) => {
  const page = await open('/?debug=1&bpm=120');
  await expect(page.getByTestId('title')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('play-bot').click();
  await expect(page.getByTestId('bot-setup')).toHaveAttribute('data-puppets', 'ready');
  await page.getByTestId('bot-difficulty-hard').click();
  await page.getByTestId('bot-puppet-yellow').click();
  await page.getByTestId('bot-start').click();
  await expect(page.getByTestId('banner')).toBeVisible();
  expect(await page.evaluate(() => window.__ttt?.botPuppetId)).toBe('preset-yellow');
});

test('the workshop opens, a stroke is drawn and the puppet is saved', async ({ open }) => {
  const page = await open('/?debug=1');
  await page.getByTestId('open-workshop').click();
  await expect(page.getByTestId('workshop')).toBeVisible();
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('no drawing surface');
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('puppet-name').fill('Csp sock');
  await page.getByTestId('save').click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const list = await window.__ttt?.app.store.puppets.list();
        return list?.some((p) => p.name === 'Csp sock') ?? false;
      }),
    )
    .toBe(true);
  await page.getByTestId('done').click();
  await expect(page.getByTestId('title')).toBeVisible();
});

test('a room of two tabs picks an uploaded song and starts', async ({ open }) => {
  const host = await open('/?net=tab&debug=1');
  await host.getByTestId('name-input').fill('Ada');
  await host.getByRole('button', { name: 'Create a room', exact: true }).click();
  await expect(host.getByTestId('lobby')).toBeVisible();
  const code = (await host.getByTestId('room-code').textContent()) ?? '';

  // The battle theme screen: an uploaded WAV is analysed (the beat detector runs in a blob: worker).
  await host.getByTestId('theme-change').click();
  await expect(host.getByTestId('theme-picker')).toBeVisible();
  await host.getByTestId('upload-input').setInputFiles({
    name: 'click140.wav',
    mimeType: 'audio/wav',
    buffer: kickTrackWav(140, 20),
  });
  await expect(host.getByTestId('theme-message')).toContainText('Found the beat', { timeout: 30_000 });
  await expect(host.getByTestId('bpm')).toContainText(/1[34]\d/);
  await host.getByTestId('done').click();
  await expect(host.getByTestId('lobby')).toBeVisible();

  const guest = await open(`/${code}?net=tab&debug=1`);
  await guest.getByTestId('name-input').fill('Bo');
  await guest.getByRole('button', { name: `Join room ${code}`, exact: true }).click();
  await expect(guest.getByTestId('lobby')).toBeVisible();
  await expect(host.getByTestId('player-1-name')).toContainText('Bo');
  await expect(guest.getByTestId('ready-toggle')).toBeEnabled({ timeout: 30_000 });
  await guest.getByTestId('ready-toggle').click();
  await host.getByTestId('ready-toggle').click();
  await expect(host.getByTestId('start')).toBeEnabled({ timeout: 30_000 });
  await host.getByTestId('start').click();
  for (const page of [host, guest]) await expect(page.getByTestId('banner')).toBeVisible();
});
