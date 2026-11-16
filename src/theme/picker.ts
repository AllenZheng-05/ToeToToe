import './picker.css';
import type { PlayHandle } from '../audio/engine';
import { startMetronome } from './metronome';
import {
  halveOrDouble,
  nudgeBpm,
  fmtBpm,
  normaliseOffset,
  parseBpmInput,
  nudgeOffset,
  offsetFromTaps,
  tapError,
  tempoFromTaps,
  detectBeat,
  type BeatSetting,
} from '../audio/tempo';
import {
  checkSongBytes,
  checkSongDuration,
  mimeForSongType,
  sha256Hex,
  songRejectionMessage,
  SONG_LIMITS,
} from '../data/songFile';
import { SETTINGS, type StoredSong } from '../data/store';
import { CLICK_TRACK, createHouseTrackSource, createLocalTrackSource, type TrackInfo } from '../data/tracks';
import { button, labelStrip, letterTiles, tapeNote, textInput, tornNote } from '../ui/kit/kit';
import { loadTheme, playTheme, withBeat, ThemeError, type LoadedTheme, type ThemeDeps } from './theme';

export interface ThemePickerOptions extends ThemeDeps {
  onDone?(selected: LoadedTheme): void;
  /** Shows a "Back to the room" button in the header: leave without choosing again. */
  onBack?(): void;
  /** The back button's words (default "Back to the room"). */
  backLabel?: string;
}

/** Seconds of lead before a preview starts, so the first beat is never in the past. */
const PREVIEW_LEAD_SEC = 0.15;
/** Taps kept for the estimate. */
const MAX_TAPS = 16;
/** Taps needed before an estimate is shown. */
const MIN_TAPS = 4;
/** Waveform bars and the number of beats they span. */
const WAVE_BARS = 86;
const WAVE_BEATS = 8;
const ACCEPT = SONG_LIMITS.types.map((t) => `.${t}`).join(',') + ',audio/mpeg,audio/ogg,audio/wav,audio/mp4';

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function tid<T extends HTMLElement>(n: T, id: string): T {
  n.dataset.testid = id;
  return n;
}

function fmtOffset(sec: number): string {
  return sec.toFixed(3);
}

function titleFromFile(name: string): string {
  const base = name.replace(/\.[^.]*$/, '').trim();
  return (base || 'My song').slice(0, 80);
}

type Preview = { kind: 'row'; id: string } | { kind: 'click' } | { kind: 'tap' };

export function createThemePicker(opts: ThemePickerOptions): { root: HTMLElement; destroy(): void } {
  const { store, engine, tunables } = opts;
  const house = opts.house ?? createHouseTrackSource();
  const deps: ThemeDeps = { store, engine, tunables, house };
  const local = createLocalTrackSource(store);

  let destroyed = false;
  let items: TrackInfo[] = [CLICK_TRACK];
  const cache = new Map<string, LoadedTheme>();
  let selectedId = CLICK_TRACK.id;
  let confirmRemove: string | null = null;
  let busy = false;

  let preview: Preview | null = null;
  let handle: PlayHandle | null = null;
  let metro: { stop(): void } | null = null;
  let songStart = 0;
  let taps: number[] = [];
  let drawToken = 0;

  // ---------- DOM ----------
  const root = h('div', 'tp-root');
  root.dataset.testid = 'theme-picker';

  const header = h('div', 'tp-header');
  const heading = letterTiles('BATTLE THEME', { size: 36 });
  const sub = h('span', 'tp-sub', 'pick the song you fight to');
  header.append(heading, sub);
  if (opts.onBack) {
    const back = button(opts.backLabel ?? 'Back to the room', {
      variant: 'pink',
      testId: 'theme-back',
      onClick: () => opts.onBack?.(),
    });
    back.classList.add('tp-back');
    header.appendChild(back);
  }

  // left panel
  const left = h('section', 'tp-panel tp-left');
  const listBox = h('div', 'tp-list');
  const dropZone = h('div', 'tp-drop');
  const dropText = h('span', 'tp-drop-text', 'drop a song here, or');
  const input = tid(h('input'), 'upload-input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.hidden = true;
  const uploadBtn = button('Upload a song', {
    variant: 'primary',
    testId: 'upload',
    onClick: () => {
      void engine.resume();
      input.click();
    },
  });
  const limits = h(
    'span',
    'tp-limits',
    `MP3, OGG, WAV or M4A, up to 10 MB and six minutes. Tempos from ${tunables.minBpm} to ${tunables.maxBpm} BPM.`,
  );
  dropZone.append(dropText, uploadBtn, limits, input);
  const privacy = tapeNote('Your song stays on this device. It is sent only to the friend in your room.', {
    rotate: -1,
  });
  privacy.classList.add('tp-privacy');
  left.append(listBox, dropZone, privacy);

  // right panel
  const right = h('section', 'tp-panel tp-right');
  const rightHead = h('div', 'tp-right-head');
  const rightStrip = labelStrip('SET THE BEAT', { tone: 'ink' });
  const rightTitle = h('span', 'tp-right-title');
  rightHead.append(rightStrip, rightTitle);

  const NS = 'http://www.w3.org/2000/svg';
  const wave = document.createElementNS(NS, 'svg');
  wave.setAttribute('viewBox', '0 0 516 80');
  wave.setAttribute('class', 'tp-wave');
  wave.setAttribute('role', 'img');
  wave.setAttribute('aria-label', 'Waveform of the chosen song with a red mark on each detected beat');

  function nudgeBtn(label: string, testId: string, aria: string, onClick: () => void): HTMLButtonElement {
    const b = tid(h('button', 'tp-nudge', label), testId);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  const bpmValue = tid(h('span', 'tp-big'), 'bpm');
  const offsetValue = tid(h('span', 'tp-big tp-big-small'), 'offset');

  const bpmRow = h('div', 'tp-ctl');
  const bpmButtons = [
    nudgeBtn('-1', 'bpm-minus-1', 'Slower by 1', () => nudge((s) => nudgeBpm(s, -1, tunables))),
    nudgeBtn('-0.1', 'bpm-minus-01', 'Slower by 0.1', () => nudge((s) => nudgeBpm(s, -0.1, tunables))),
    nudgeBtn('-0.01', 'bpm-minus-001', 'Slower by 0.01', () => nudge((s) => nudgeBpm(s, -0.01, tunables))),
  ];
  const bpmButtonsAfter = [
    nudgeBtn('+0.01', 'bpm-plus-001', 'Faster by 0.01', () => nudge((s) => nudgeBpm(s, 0.01, tunables))),
    nudgeBtn('+0.1', 'bpm-plus-01', 'Faster by 0.1', () => nudge((s) => nudgeBpm(s, 0.1, tunables))),
    nudgeBtn('+1', 'bpm-plus-1', 'Faster by 1', () => nudge((s) => nudgeBpm(s, 1, tunables))),
  ];
  const bpmField = textInput({
    label: 'TYPE A TEMPO',
    placeholder: `${tunables.minBpm} to ${tunables.maxBpm}`,
    maxLength: 9,
    testId: 'bpm-input',
  });
  bpmField.input.inputMode = 'decimal';
  bpmField.input.setAttribute('aria-label', 'Type a tempo in BPM');
  const bpmSet = button('Set', {
    variant: 'small',
    testId: 'bpm-set',
    onClick: () => applyTypedBpm(),
  });
  bpmField.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyTypedBpm();
  });
  const halfBtn = button('Half tempo', {
    variant: 'small',
    testId: 'half',
    onClick: () => nudge((s) => halveOrDouble(s, 0.5, tunables)),
  });
  const doubleBtn = button('Double tempo', {
    variant: 'small',
    testId: 'double',
    onClick: () => nudge((s) => halveOrDouble(s, 2, tunables)),
  });
  const bpmGroup = h('div', 'tp-group');
  const bpmLabelRow = h('div', 'tp-label-row');
  const bpmHalfDouble = h('div', 'tp-group-row');
  bpmHalfDouble.append(halfBtn, doubleBtn);
  bpmLabelRow.append(h('span', 'tp-label', 'TEMPO WE HEARD'), bpmHalfDouble);
  const bpmControls = h('div', 'tp-group-row');
  bpmControls.append(...bpmButtons, bpmValue, h('span', 'tp-unit', 'BPM'), ...bpmButtonsAfter);
  const bpmTyped = h('div', 'tp-group-row');
  bpmTyped.append(bpmField.root, bpmSet);
  bpmGroup.append(bpmLabelRow, bpmControls, bpmTyped);
  bpmRow.append(bpmGroup);

  const offsetButtons = [
    nudgeBtn('-20', 'offset-minus-20', 'First beat 20 ms earlier', () => nudge((s) => nudgeOffset(s, -20))),
    nudgeBtn('-5', 'offset-minus-5', 'First beat 5 ms earlier', () => nudge((s) => nudgeOffset(s, -5))),
  ];
  const offsetButtonsAfter = [
    nudgeBtn('+5', 'offset-plus-5', 'First beat 5 ms later', () => nudge((s) => nudgeOffset(s, 5))),
    nudgeBtn('+20', 'offset-plus-20', 'First beat 20 ms later', () => nudge((s) => nudgeOffset(s, 20))),
  ];
  const offsetGroup = h('div', 'tp-group');
  offsetGroup.append(
    h('span', 'tp-label', 'FIRST BEAT (MS STEPS)'),
    (() => {
      const r = h('div', 'tp-group-row');
      r.append(...offsetButtons, offsetValue, h('span', 'tp-unit', 's'), ...offsetButtonsAfter);
      return r;
    })(),
  );
  const readOnly = h('span', 'tp-readonly', '');

  const listenClickBtn = button('Listen with click', {
    variant: 'secondary',
    testId: 'listen-click',
    onClick: () => void toggleListenClick(),
  });
  const stopBtn = button('Stop', {
    variant: 'small',
    testId: 'stop-preview',
    onClick: () => stopPreview(),
  });
  const tapBtn = button('Tap along', { variant: 'pink', testId: 'tap' });
  tapBtn.classList.add('tp-tap');
  const dots = h('div', 'tp-dots');
  const dotEls = Array.from({ length: MIN_TAPS }, () => dots.appendChild(h('span', 'tp-dot')));
  const tapHint = h('span', 'tp-tap-hint', 'tap on every beat to check we heard it right');
  const tapBox = h('div', 'tp-tapbox');
  tapBox.append(tapBtn, dots, tapHint);
  const tapResult = h('div', 'tp-tapresult');
  const tapResultText = h('span', 'tp-tapresult-text');
  const useTaps = button('Use these', {
    variant: 'small',
    testId: 'use-taps',
    onClick: () => void applyTaps(),
  });
  tapResult.append(tapResultText, useTaps);
  tapResult.hidden = true;

  const message = tid(tornNote('', { rotate: -1 }), 'theme-message');
  message.classList.add('tp-message');
  message.hidden = true;
  message.setAttribute('role', 'status');

  const doneBtn = button('Use this theme', {
    variant: 'primary',
    testId: 'done',
    onClick: () => void finish(),
  });
  const footer = h('div', 'tp-footer');
  footer.append(listenClickBtn, stopBtn, doneBtn);

  right.append(rightHead, wave, bpmRow, offsetGroup, readOnly, tapBox, tapResult, message, footer);
  root.append(header, left, right);

  // ---------- helpers ----------
  function setMessage(text: string | null): void {
    message.textContent = text ?? '';
    message.hidden = !text;
  }

  function selectedInfo(): TrackInfo {
    return items.find((i) => i.id === selectedId) ?? CLICK_TRACK;
  }

  function editable(info: TrackInfo): boolean {
    return info.source === 'upload';
  }

  function toLoaded(info: TrackInfo): Promise<LoadedTheme> {
    const cached = cache.get(info.id);
    if (cached) {
      const next = withBeat(cached, info, tunables);
      cache.set(info.id, next);
      return Promise.resolve(next);
    }
    return loadTheme(info, deps).then((t) => {
      cache.set(info.id, t);
      return t;
    });
  }

  function now(): number {
    return engine.clock.now();
  }

  // ---------- preview audio ----------
  function stopPreview(): void {
    metro?.stop();
    metro = null;
    handle?.stop();
    handle = null;
    preview = null;
    taps = [];
    renderTaps();
    renderPlaying();
  }

  function renderPlaying(): void {
    stopBtn.hidden = preview === null;
    listenClickBtn.textContent = preview?.kind === 'click' ? 'Stop the click' : 'Listen with click';
    root.querySelectorAll<HTMLButtonElement>('[data-listen]').forEach((b) => {
      const on = preview?.kind === 'row' && preview.id === b.dataset.listen;
      b.textContent = on ? 'Stop' : 'Listen';
      b.setAttribute('aria-pressed', String(on));
    });
    tapBtn.setAttribute('aria-pressed', String(preview?.kind === 'tap'));
  }

  async function startRow(info: TrackInfo): Promise<void> {
    stopPreview();
    await engine.resume();
    try {
      const theme = await toLoaded(info);
      if (destroyed) return;
      stopPreview();
      handle = playTheme(theme, engine, now() + PREVIEW_LEAD_SEC);
      preview = { kind: 'row', id: info.id };
      renderPlaying();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That song could not be played.');
    }
  }

  /** Play the selected song from its very start, then loop its phrases; optionally with the click on top. */
  async function startFromStart(kind: 'click' | 'tap'): Promise<void> {
    stopPreview();
    await engine.resume();
    try {
      const theme = await toLoaded(selectedInfo());
      if (destroyed) return;
      stopPreview();
      songStart = now() + PREVIEW_LEAD_SEC;
      handle = engine.playLoop(theme.buffer, {
        startTime: songStart,
        offset: 0,
        loopStart: theme.loopStart,
        loopEnd: theme.loopEnd,
      });
      preview = { kind };
      if (kind === 'click') {
        metro = startMetronome(engine, {
          bpm: theme.info.bpm,
          startTime: songStart + theme.info.firstBeatOffset,
        });
      }
      renderPlaying();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That song could not be played.');
    }
  }

  async function toggleListenClick(): Promise<void> {
    if (preview?.kind === 'click') {
      stopPreview();
      return;
    }
    await startFromStart('click');
  }

  // ---------- beat editing ----------
  async function saveBeat(info: TrackInfo, beat: BeatSetting): Promise<void> {
    const next: TrackInfo = { ...info, bpm: beat.bpm, firstBeatOffset: beat.firstBeatOffset };
    items = items.map((i) => (i.id === info.id ? next : i));
    if (info.source === 'upload') {
      const song = await store.songs.get(info.id);
      if (song) await store.songs.put({ ...song, bpm: beat.bpm, firstBeatOffset: beat.firstBeatOffset });
    }
    renderBeat();
    renderList();
    void drawWave();
    if (preview?.kind === 'click') void startFromStart('click');
  }

  function applyTypedBpm(): void {
    const info = selectedInfo();
    if (!editable(info)) return;
    const bpm = parseBpmInput(bpmField.input.value, tunables.minBpm, tunables.maxBpm);
    if (bpm === null) {
      setMessage(`Type a tempo from ${tunables.minBpm} to ${tunables.maxBpm}, such as 222.22.`);
      return;
    }
    setMessage(null);
    bpmField.input.value = '';
    nudge((s) => ({ bpm, firstBeatOffset: normaliseOffset(s.firstBeatOffset, bpm) }));
  }

  function nudge(f: (s: BeatSetting) => BeatSetting): void {
    const info = selectedInfo();
    if (!editable(info)) return;
    void saveBeat(info, f({ bpm: info.bpm, firstBeatOffset: info.firstBeatOffset }));
  }

  // ---------- tap along ----------
  function renderTaps(): void {
    dotEls.forEach((d, i) => d.classList.toggle('tp-dot-on', i < taps.length));
    const info = selectedInfo();
    if (taps.length < MIN_TAPS) {
      tapResult.hidden = true;
      tapHint.textContent =
        preview?.kind === 'tap'
          ? `${taps.length} of ${MIN_TAPS} taps. Tap on every beat.`
          : 'tap on every beat to check we heard it right';
      return;
    }
    const tempo = tempoFromTaps(taps, tunables);
    tapResult.hidden = false;
    if (tempo === null) {
      tapResultText.textContent = 'Those taps were uneven. Keep tapping, or try again.';
      useTaps.disabled = true;
      return;
    }
    const offset = offsetFromTaps(taps, tempo) ?? 0;
    const err = tapError(taps, { bpm: info.bpm, firstBeatOffset: info.firstBeatOffset });
    const ms = err === null ? 0 : Math.round(Math.abs(err));
    const when = err !== null && err < 0 ? 'early' : 'late';
    tapResultText.textContent =
      `We heard ${fmtBpm(tempo)} BPM, first beat ${fmtOffset(offset)} s. ` +
      (ms === 0 ? 'Your taps match the current setting.' : `Your taps are ${ms} ms ${when}.`);
    useTaps.disabled = !editable(info);
    pendingTaps = { bpm: tempo, firstBeatOffset: offset };
  }

  let pendingTaps: BeatSetting | null = null;

  async function applyTaps(): Promise<void> {
    const info = selectedInfo();
    if (!pendingTaps || !editable(info)) return;
    const beat = pendingTaps;
    stopPreview();
    await saveBeat(info, beat);
  }

  tapBtn.addEventListener('pointerdown', (ev) => {
    void engine.resume();
    if (preview?.kind !== 'tap') {
      void startFromStart('tap');
      return;
    }
    const t = engine.clock.timeOfEvent(ev.timeStamp) - songStart;
    taps = [...taps, t].slice(-MAX_TAPS);
    renderTaps();
  });
  // Keyboard users can start the song with Enter or Space (a click with no pointer).
  tapBtn.addEventListener('click', (ev) => {
    if (ev.detail === 0 && preview?.kind !== 'tap') void startFromStart('tap');
  });

  // ---------- render ----------
  function renderBeat(): void {
    const info = selectedInfo();
    bpmValue.textContent = fmtBpm(info.bpm);
    offsetValue.textContent = fmtOffset(info.firstBeatOffset);
    rightTitle.textContent = info.title;
    const can = editable(info);
    for (const b of [
      ...bpmButtons,
      ...bpmButtonsAfter,
      bpmField.input,
      bpmSet,
      ...offsetButtons,
      ...offsetButtonsAfter,
      halfBtn,
      doubleBtn,
    ]) {
      b.disabled = !can;
    }
    tapBtn.disabled = false;
    readOnly.textContent = can
      ? ''
      : info.source === 'click'
        ? 'The click track is always at 120 BPM.'
        : 'House tracks are already set to the beat.';
    readOnly.hidden = can;
    renderTaps();
  }

  async function drawWave(): Promise<void> {
    const token = ++drawToken;
    const info = selectedInfo();
    let theme: LoadedTheme;
    try {
      theme = await toLoaded(info);
    } catch {
      return;
    }
    if (token !== drawToken || destroyed) return;
    const data = theme.buffer.getChannelData(0);
    const rate = theme.buffer.sampleRate;
    const beat = 60 / info.bpm;
    const span = Math.min(theme.buffer.duration, WAVE_BEATS * beat + info.firstBeatOffset);
    const per = Math.max(1, Math.floor((span * rate) / WAVE_BARS));
    const barSec = per / rate;
    const peaks: number[] = [];
    let max = 1e-6;
    for (let i = 0; i < WAVE_BARS; i++) {
      let p = 0;
      const from = i * per;
      for (let j = from; j < from + per && j < data.length; j += 8) p = Math.max(p, Math.abs(data[j] ?? 0));
      peaks.push(p);
      max = Math.max(max, p);
    }
    const marked = new Set<number>();
    for (let k = 0; ; k++) {
      const t = info.firstBeatOffset + k * beat;
      if (t >= span) break;
      marked.add(Math.floor(t / barSec));
    }
    wave.replaceChildren();
    peaks.forEach((p, i) => {
      const hgt = Math.max(4, (p / max) * 62);
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(6 + i * 6));
      r.setAttribute('y', String(40 - hgt / 2));
      r.setAttribute('width', '4');
      r.setAttribute('height', String(hgt));
      r.setAttribute('fill', marked.has(i) ? '#D42A40' : '#1B1210');
      wave.appendChild(r);
    });
  }

  function infoLine(info: TrackInfo): string {
    return `${fmtBpm(info.bpm)} BPM`;
  }

  function row(info: TrackInfo): HTMLElement {
    const selected = info.id === selectedId;
    const r = tid(h('div', 'tp-row'), `theme-row-${info.id}`);
    r.setAttribute('role', 'button');
    r.tabIndex = 0;
    r.setAttribute('aria-pressed', String(selected));
    r.dataset.selected = String(selected);
    const text = h('div', 'tp-row-text');
    text.append(h('span', 'tp-row-title', info.title));
    const sub =
      info.source === 'upload' ? 'your song' : (info.credit ?? (info.source === 'click' ? 'built in' : ''));
    if (sub) text.append(h('span', 'tp-row-credit', sub));
    const side = h('div', 'tp-row-side');
    side.append(h('span', 'tp-row-tempo', infoLine(info)));
    if (selected) side.append(h('span', 'tp-selected', 'SELECTED'));
    const listen = tid(
      button('Listen', {
        variant: 'small',
        onClick: () => {
          if (preview?.kind === 'row' && preview.id === info.id) stopPreview();
          else void startRow(info);
        },
      }),
      `listen-${info.id}`,
    );
    listen.dataset.listen = info.id;
    listen.addEventListener('click', (e) => e.stopPropagation());
    side.append(listen);
    if (info.source === 'upload') {
      const armed = confirmRemove === info.id;
      const rm = tid(
        button(armed ? 'Sure?' : 'Remove', {
          variant: armed ? 'danger' : 'small',
          onClick: () => void removeSong(info),
        }),
        `remove-${info.id}`,
      );
      rm.addEventListener('click', (e) => e.stopPropagation());
      side.append(rm);
    }
    r.append(text, side);
    const choose = (): void => void select(info.id);
    r.addEventListener('click', choose);
    r.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === r) {
        e.preventDefault();
        choose();
      }
    });
    return r;
  }

  function renderList(): void {
    listBox.replaceChildren();
    const houseItems = items.filter((i) => i.source !== 'upload');
    const mine = items.filter((i) => i.source === 'upload');
    listBox.append(labelStrip('HOUSE TRACKS'));
    houseItems.forEach((i) => listBox.append(row(i)));
    const mineStrip = labelStrip('MY TRACKS');
    mineStrip.classList.add('tp-strip-gap');
    listBox.append(mineStrip);
    if (mine.length === 0) listBox.append(h('span', 'tp-empty', 'No songs of your own yet.'));
    mine.forEach((i) => listBox.append(row(i)));
    renderPlaying();
    // Keep the selected row in view without scrolling anything but the list.
    const sel = listBox.querySelector<HTMLElement>('[data-selected="true"]');
    if (sel) {
      const top = sel.offsetTop;
      if (top < listBox.scrollTop) listBox.scrollTop = top;
      else if (top + sel.offsetHeight > listBox.scrollTop + listBox.clientHeight)
        listBox.scrollTop = top + sel.offsetHeight - listBox.clientHeight;
    }
  }

  async function select(id: string): Promise<void> {
    void engine.resume();
    confirmRemove = null;
    if (id !== selectedId) {
      stopPreview();
      selectedId = id;
      setMessage(null);
      await store.settings.set(SETTINGS.selectedThemeId, id);
    }
    renderList();
    renderBeat();
    void drawWave();
  }

  async function removeSong(info: TrackInfo): Promise<void> {
    if (confirmRemove !== info.id) {
      confirmRemove = info.id;
      renderList();
      return;
    }
    confirmRemove = null;
    if (preview?.kind === 'row' && preview.id === info.id) stopPreview();
    await store.songs.delete(info.id);
    cache.delete(info.id);
    items = items.filter((i) => i.id !== info.id);
    if (selectedId === info.id) {
      stopPreview();
      selectedId = CLICK_TRACK.id;
      await store.settings.set(SETTINGS.selectedThemeId, selectedId);
    }
    renderList();
    renderBeat();
    void drawWave();
  }

  // ---------- upload ----------
  async function handleFile(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    setMessage('Reading…');
    try {
      if (file.size > SONG_LIMITS.maxBytes) {
        setMessage(songRejectionMessage('size'));
        return;
      }
      const data = await file.arrayBuffer();
      const checked = checkSongBytes(data);
      if (!checked.ok) {
        setMessage(songRejectionMessage(checked.reason));
        return;
      }
      let buffer: AudioBuffer;
      try {
        buffer = await engine.decode(data.slice(0));
      } catch {
        setMessage(songRejectionMessage('decode'));
        return;
      }
      const long = checkSongDuration(buffer.duration);
      if (!long.ok) {
        setMessage(songRejectionMessage(long.reason));
        return;
      }
      const hash = await sha256Hex(data);
      const existing = (await store.songs.list()).find((s) => s.hash === hash);
      if (existing) {
        await refreshItems();
        await select(existing.id);
        setMessage('You already have that song. It is selected.');
        return;
      }
      setMessage('Finding the beat…');
      const found = await detectBeat(buffer, tunables);
      const song: StoredSong = {
        id: crypto.randomUUID(),
        title: titleFromFile(file.name),
        mime: mimeForSongType(checked.type),
        bytes: data.byteLength,
        hash,
        data,
        bpm: found.bpm,
        firstBeatOffset: found.firstBeatOffset,
        durationSec: buffer.duration,
        createdAt: Date.now(),
      };
      await store.songs.put(song);
      await refreshItems();
      await select(song.id);
      setMessage(
        found.detected
          ? 'Found the beat. Check it with Listen with click, and nudge it if it is off.'
          : 'We could not find the beat. Set it by hand with the buttons.',
      );
    } catch {
      setMessage(songRejectionMessage('decode'));
    } finally {
      busy = false;
    }
  }

  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void handleFile(f);
  });
  left.addEventListener('dragover', (e) => {
    e.preventDefault();
    left.classList.add('tp-dragging');
  });
  left.addEventListener('dragleave', () => left.classList.remove('tp-dragging'));
  left.addEventListener('drop', (e) => {
    e.preventDefault();
    left.classList.remove('tp-dragging');
    const f = e.dataTransfer?.files[0];
    if (f) {
      void engine.resume();
      void handleFile(f);
    }
  });

  // ---------- finish ----------
  async function finish(): Promise<void> {
    void engine.resume();
    stopPreview();
    try {
      const theme = await toLoaded(selectedInfo());
      if (destroyed) return;
      opts.onDone?.(theme);
    } catch (e) {
      setMessage(e instanceof ThemeError ? e.message : 'That song could not be loaded.');
    }
  }

  async function refreshItems(): Promise<void> {
    let houseTracks: TrackInfo[] = [];
    try {
      houseTracks = await house.list();
    } catch {
      /* no house tracks: the click track and uploads only */
    }
    let mine: TrackInfo[] = [];
    try {
      mine = await local.list();
    } catch {
      /* uploads unavailable */
    }
    // Keep the player's edits to an in-memory entry, the store is the truth for uploads.
    items = [CLICK_TRACK, ...houseTracks, ...mine];
    if (!items.some((i) => i.id === selectedId)) selectedId = CLICK_TRACK.id;
  }

  void (async () => {
    selectedId = await store.settings.get<string>(SETTINGS.selectedThemeId, CLICK_TRACK.id);
    await refreshItems();
    if (destroyed) return;
    renderList();
    renderBeat();
    renderPlaying();
    void drawWave();
  })();
  renderList();
  renderBeat();
  renderPlaying();

  return {
    root,
    destroy() {
      destroyed = true;
      stopPreview();
      root.remove();
    },
  };
}
