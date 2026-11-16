import type { App, FrameInfo } from '../app/app';
import { DEFAULT_TUNABLES } from '../core/tunables';
import type { SessionEvent } from '../core/session';
import type { BeatGrid, Tunables } from '../core/types';
import type { Room } from '../net/room';
import { ScriptRunner, type ScriptEvent } from './script';

declare global {
  interface Window {
    /** Debug hooks (?debug=1) for tests and tinkering. */
    __ttt?: {
      app: App;
      session: App['session'];
      room: Room | null;
      grid: BeatGrid | null;
      /** Session events seen, oldest first, capped at 500. */
      events: SessionEvent[];
      /** Player healths after each judged strike: {phrase, health: [p0, p1]}. */
      healthLog: App['healthLog'];
      /** Queue scripted clicks; see src/debug/script.ts. */
      script(events: ScriptEvent[]): void;
    };
  }
}

const FPS_SMOOTHING = 0.1;

function row(parent: HTMLElement, label: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'dbg-row';
  const k = document.createElement('span');
  k.className = 'dbg-key';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'dbg-val';
  r.append(k, v);
  parent.appendChild(r);
  return v;
}

function set(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Debug panel for ?debug=1. Reads the app and edits the live Tunables object in place. */
export function createDebugOverlay(app: App): void {
  const runner = new ScriptRunner(app);
  Object.defineProperty(window, '__ttt', {
    configurable: true,
    get: () => ({
      app,
      session: app.session,
      room: app.connection?.room ?? null,
      grid: app.match?.grid ?? null,
      events: app.events,
      healthLog: app.healthLog,
      script: (events: ScriptEvent[]) => runner.add(events),
    }),
  });

  const panel = document.createElement('div');
  panel.className = 'debug-overlay';
  panel.dataset.testid = 'debug-overlay';
  document.body.appendChild(panel);

  const beat = row(panel, 'beat');
  const audio = row(panel, 'audio clock');
  const fpsEl = row(panel, 'fps');
  const offset = row(panel, 'input offset');
  const link = row(panel, 'connection');

  const accRow = document.createElement('label');
  accRow.className = 'dbg-row';
  const accKey = document.createElement('span');
  accKey.className = 'dbg-key';
  accKey.textContent = 'bot accuracy';
  const acc = document.createElement('input');
  acc.type = 'number';
  acc.min = '0';
  acc.max = '1';
  acc.step = '0.05';
  acc.dataset.testid = 'debug-bot-accuracy';
  acc.addEventListener('input', () => {
    const v = Number(acc.value);
    const bot = app.match?.bot;
    if (bot && Number.isFinite(v)) bot.options.accuracy = Math.min(1, Math.max(0, v));
  });
  accRow.append(accKey, acc);
  panel.appendChild(accRow);

  const phrase = document.createElement('pre');
  phrase.className = 'dbg-phrase';
  phrase.dataset.testid = 'debug-phrase';
  panel.appendChild(phrase);

  const tunHead = document.createElement('div');
  tunHead.className = 'dbg-head';
  tunHead.textContent = 'Tunables';
  panel.appendChild(tunHead);
  const inputs = new Map<keyof Tunables, HTMLInputElement>();
  for (const key of Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[]) {
    const label = document.createElement('label');
    label.className = 'dbg-row';
    const k = document.createElement('span');
    k.className = 'dbg-key';
    k.textContent = key;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.dataset.testid = `tunable-${key}`;
    input.value = String(app.tunables[key]);
    input.addEventListener('input', () => {
      const v = input.valueAsNumber;
      if (!Number.isFinite(v)) return;
      app.tunables[key] = v;
      // The host's edits reach the guest, who adopts them (Room applies `tunables` at any time).
      const conn = app.connection;
      if (conn?.role === 'host') conn.transport.send({ t: 'tunables', tunables: { ...app.tunables } });
    });
    label.append(k, input);
    panel.appendChild(label);
    inputs.set(key, input);
  }

  let fps = 60;
  let last = 0;
  app.onFrame((info: FrameInfo) => {
    if (last > 0 && !info.hidden) {
      const dt = info.timestamp - last;
      if (dt > 0) fps += (1000 / dt - fps) * FPS_SMOOTHING;
    }
    last = info.timestamp;
    set(fpsEl, info.hidden ? 'hidden' : fps.toFixed(0));

    const session = app.session;
    if (app.hasEngine) set(audio, app.engine.clock.now().toFixed(3));
    else set(audio, '-');

    if (session) {
      const v = session.view();
      set(
        beat,
        `phrase ${v.clockPhrase}  slot ${v.slotPosition.toFixed(2)}  beat ${v.beatPosition.toFixed(2)}  ${v.phase}`,
      );
      const s = session.state;
      phrase.textContent = JSON.stringify(
        { phase: s.phase, phrase: s.phrase, attacker: s.attacker, strikes: s.strikes, results: s.results },
        null,
        1,
      );
    } else {
      set(beat, '-');
      phrase.textContent = '';
    }

    const offsets = app.judgedOffsets;
    const lastOffset = offsets[offsets.length - 1];
    if (lastOffset === undefined) {
      set(offset, '-');
    } else {
      const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
      set(offset, `${lastOffset.toFixed(1)} ms  mean ${mean.toFixed(1)} ms (${offsets.length})`);
    }

    runner.update();

    const conn = app.connection;
    if (conn) {
      const { room, transport } = conn;
      const rtt = room.rttMs === null ? '-' : `${room.rttMs.toFixed(0)} ms`;
      const off = room.role === 'host' ? '0 ms' : `${(room.clockOffsetSec * 1000).toFixed(1)} ms`;
      set(link, `${transport.state}  ${room.role}  rtt ${rtt}  offset ${off}`);
    } else {
      const transport = app.match?.transport;
      set(link, transport ? `${transport.state}  ${transport.role}` : '-');
    }

    const bot = app.match?.bot;
    if (bot && document.activeElement !== acc) acc.value = String(bot.options.accuracy);
    acc.disabled = !bot;

    for (const [key, input] of inputs) {
      if (document.activeElement !== input) {
        const text = String(app.tunables[key]);
        if (input.value !== text) input.value = text;
      }
    }
  });
}
