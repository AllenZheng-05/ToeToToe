import type { App } from '../app/app';
import { awaitAudio } from '../app/audioGate';
import type { BeatGrid, Unsubscribe } from '../core/types';
import { startMetronome } from '../theme/metronome';
import { letterTiles, tornNote } from '../ui/kit/kit';
import { menuButton, node, sceneRoot, signContent } from '../ui/menu';
import {
  CALIBRATION_BPM,
  CALIBRATION_LEAD_SEC,
  clampOffset,
  describeOffset,
  describeStored,
  estimateOffset,
  FIRST_RESULT_TAPS,
  NUDGE_MS,
  tapErrorMs,
  WINDOW_TAPS,
  type OffsetEstimate,
} from './calibrationModel';
import type { Scene } from './types';

const NOTE = 'Speakers, Bluetooth and screens add delay. Tap along so the game can allow for it.';
/** The ring starts this much larger than the target and closes on it as the beat arrives. */
const RING_EXTRA = 0.9;
/** The target lights up for this share of a beat after the click. */
const FLASH_SHARE = 0.14;

export interface CalibrationOptions {
  /** The scene to return to (title or lobby). */
  back(): Scene;
}

/**
 * Input calibration: a click at 100 BPM on the audio clock, a ring that closes on a big target at each
 * beat, and taps stamped with the audio clock. The average lateness becomes the input offset.
 */
export class CalibrationScene implements Scene {
  private root: HTMLElement | null = null;
  private metronome: { stop(): void } | null = null;
  private off: Unsubscribe | null = null;
  private exited = false;
  private grid: BeatGrid | null = null;
  private readonly taps: number[] = [];
  private tapCount = 0;
  private estimate: OffsetEstimate | null = null;

  constructor(
    private readonly app: App,
    private readonly opts: CalibrationOptions,
  ) {}

  async enter(): Promise<void> {
    const { app } = this;
    const root = sceneRoot('calibration', 'calibration');
    root.dataset.state = 'starting';
    this.root = root;

    // The sign: what this is for, and what the taps came to.
    const sign = signContent(root, 'sign-calibration');
    const title = node('h1', 'sign-heading', sign);
    title.setAttribute('aria-label', 'Timing');
    title.appendChild(letterTiles('TIMING', { palette: 'banner', size: 48 }));
    const note = tornNote(NOTE, { rotate: -1, width: 540 });
    note.classList.add('calibration-note');
    sign.appendChild(note);
    const result = node('div', 'sign-status', sign, 'calibration-result', 'Tap the target with each click');
    result.setAttribute('role', 'status');

    // The target and the closing ring.
    const stage = node('div', 'calib-stage', root);
    const ring = node('div', 'calib-ring', stage);
    const target = node('button', 'calib-target', stage, 'calibration-target', 'TAP');
    target.type = 'button';
    target.setAttribute('aria-label', 'Tap along with the click');

    // Stored value and the last tap.
    const info = node('div', 'calib-info', root);
    const stored = node('div', 'calib-stored', info, 'calibration-stored');
    const last = node('div', 'calib-last', info, 'calibration-last');

    // The ledge: use, reset, fine adjust, done.
    const row = node('div', 'ledge-row ledge-calibration', root);
    const use = menuButton(
      'Use this',
      'calibration-use',
      'primary',
      () => {
        if (this.estimate) this.setStored(this.estimate.meanMs);
      },
      'main',
    );
    use.disabled = true;
    const reset = menuButton('Reset to 0', 'calibration-reset', 'secondary', () => this.setStored(0), 'side');
    const minus = menuButton(
      `−${NUDGE_MS} ms`,
      'calibration-minus',
      'secondary',
      () => this.setStored(app.inputOffsetMs - NUDGE_MS),
      'side',
    );
    const plus = menuButton(
      `+${NUDGE_MS} ms`,
      'calibration-plus',
      'secondary',
      () => this.setStored(app.inputOffsetMs + NUDGE_MS),
      'side',
    );
    const done = menuButton('Done', 'calibration-done', 'pink', () => void app.go(this.opts.back()), 'main');
    row.append(use, reset, minus, plus, done);

    const showStored = (): void => {
      stored.textContent = describeStored(app.inputOffsetMs);
    };
    this.refresh = () => {
      showStored();
      const e = this.estimate;
      if (this.tapCount < FIRST_RESULT_TAPS || !e) {
        const left = Math.max(0, FIRST_RESULT_TAPS - this.tapCount);
        result.textContent =
          this.tapCount === 0
            ? 'Tap the target with each click'
            : left > 0
              ? `Keep tapping (${left} more)`
              : 'Keep tapping along';
        use.disabled = true;
        return;
      }
      result.textContent = `${describeOffset(e.meanMs)} (±${Math.round(e.spreadMs)} ms)`;
      result.dataset.mean = String(Math.round(e.meanMs));
      use.disabled = false;
    };
    this.refresh();
    app.overlay.appendChild(root);

    target.addEventListener('pointerdown', (ev) => {
      if (!ev.isPrimary || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      // Stamp the arrival on the audio clock first, before any other work.
      const time = app.engine.clock.timeOfEvent(ev.timeStamp);
      ev.preventDefault();
      this.onTap(time, last);
    });

    await awaitAudio(app);
    if (this.exited) return;
    const { engine } = app;
    const grid: BeatGrid = { bpm: CALIBRATION_BPM, startTime: engine.clock.now() + CALIBRATION_LEAD_SEC };
    this.grid = grid;
    this.metronome = startMetronome(engine, grid);
    root.dataset.state = 'running';
    root.dataset.bpm = String(grid.bpm);
    root.dataset.start = String(grid.startTime);

    const beat = 60 / grid.bpm;
    this.off = app.onFrame(() => {
      // The ring and the flash come from the audio clock each frame; nothing here times the beat.
      const t = engine.clock.now() - grid.startTime;
      if (t < 0) return;
      const p = (t / beat) % 1;
      ring.style.transform = `scale(${(1 + RING_EXTRA * (1 - p)).toFixed(3)})`;
      ring.style.opacity = (0.35 + 0.65 * p).toFixed(2);
      target.classList.toggle('flash', p < FLASH_SHARE);
    });
  }

  exit(): void {
    this.exited = true;
    this.off?.();
    this.off = null;
    this.metronome?.stop();
    this.metronome = null;
    this.root?.remove();
    this.root = null;
  }

  private refresh: () => void = () => {};

  private onTap(time: number, last: HTMLElement): void {
    const grid = this.grid;
    if (!grid) return;
    this.tapCount++;
    this.taps.push(time);
    if (this.taps.length > WINDOW_TAPS) this.taps.shift();
    this.estimate = estimateOffset(this.taps, grid);
    const err = Math.round(tapErrorMs(time, grid));
    last.textContent = `Last tap: ${describeOffset(err).replace('You tap ', '')}`;
    this.refresh();
  }

  private setStored(ms: number): void {
    this.app.setInputOffset(clampOffset(ms));
    this.refresh();
  }
}
