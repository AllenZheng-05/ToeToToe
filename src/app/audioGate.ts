import type { App } from './app';

/**
 * Browsers (iOS above all) keep audio off until a tap. The first tap anywhere resumes the context;
 * a screen that needs sound waits behind "Tap to turn the sound on" when it is still off.
 */

const GATE_TEXT = 'Tap to turn the sound on';

function resumeQuietly(app: App): void {
  app.engine.resume().catch(() => {
    /* still locked; the next tap tries again */
  });
}

/** Resume audio on the first tap (touch end, click) anywhere, then stop listening once it is running. */
export function unlockAudioOnFirstTap(app: App): void {
  const events = ['pointerdown', 'pointerup', 'click', 'touchend'] as const;
  const onTap = (): void => {
    resumeQuietly(app);
    if (app.hasEngine && app.engine.running) for (const e of events) document.removeEventListener(e, onTap);
  };
  for (const e of events) document.addEventListener(e, onTap, { passive: true });
}

interface Gate {
  remove(): void;
}

/** A full-stage catcher with a note in the middle; any tap on it resumes audio. */
function showGate(app: App): Gate {
  const cover = document.createElement('div');
  cover.className = 'audio-gate';
  cover.dataset.testid = 'audio-gate';
  cover.setAttribute('role', 'button');
  cover.tabIndex = 0;
  const note = document.createElement('div');
  note.className = 'audio-gate-note';
  note.textContent = GATE_TEXT;
  cover.appendChild(note);
  const tap = (): void => resumeQuietly(app);
  cover.addEventListener('pointerup', tap);
  cover.addEventListener('click', tap);
  app.overlay.appendChild(cover);
  return { remove: () => cover.remove() };
}

/**
 * Resolves once the audio context is running. Called from a tap, it normally resolves at once;
 * if the browser still refuses, "Tap to turn the sound on" is shown until a tap works.
 */
export function awaitAudio(app: App): Promise<void> {
  const ctx = app.engine.context;
  resumeQuietly(app);
  if (ctx.state === 'running') return Promise.resolve();
  return new Promise((resolve) => {
    const gate = showGate(app);
    const check = (): void => {
      if (ctx.state !== 'running') return;
      ctx.removeEventListener('statechange', check);
      gate.remove();
      resolve();
    };
    ctx.addEventListener('statechange', check);
    check();
  });
}

/** Keeps "Tap to turn the sound on" up whenever the context is not running (lobby, duel). Returns a stop function. */
export function watchAudio(app: App): () => void {
  let gate: Gate | null = null;
  const off = app.onFrame(() => {
    const locked = app.hasEngine && !app.engine.running;
    if (locked && !gate) gate = showGate(app);
    else if (!locked && gate) {
      gate.remove();
      gate = null;
    }
  });
  return () => {
    off();
    gate?.remove();
    gate = null;
  };
}
