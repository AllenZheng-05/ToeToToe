import { slotTime, slotsPerPhrase } from '../core/beat';
import { DuelSession } from '../core/session';
import type { BeatGrid, Clock, PlayerId, Transport, Tunables } from '../core/types';
import { createLoopbackPair } from './loopback';

export interface BotOptions {
  /** Chance of parrying each strike, 0..1. Default 0.75. */
  accuracy: number;
  /** Of successful parries, the share that are Bravo. Default 0.4. */
  bravoRate: number;
  /** Strikes the bot tries to plant per attack phrase, inclusive range. Default [3, 6]. */
  strikes: [number, number];
  /** Seed for the bot's deterministic random generator. Default 1. */
  seed: number;
}

const DEFAULT_OPTIONS: BotOptions = { accuracy: 0.75, bravoRate: 0.4, strikes: [3, 6], seed: 1 };

const X_MIN = 0.12;
const X_MAX = 0.88;
const Y_MIN = 0.15;
const Y_MAX = 0.85;
/** Random-walk step lengths, in play-area widths. */
const STEP_MIN = 0.15;
const STEP_MAX = 0.45;
/** Timing errors stay inside this share of their window. */
const WINDOW_SAFETY = 0.8;

/** Small seeded PRNG (mulberry32). Returns numbers in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlannedClick {
  time: number;
  x: number;
  y: number;
  fired: boolean;
}

/** Plays one side of a match by feeding synthetic clicks into a session. Uses no timers: call update() every frame. */
export class BotDriver {
  readonly options: BotOptions;
  private readonly rng: () => number;
  private attackPhrase: number | null = null;
  private attackPlan: PlannedClick[] = [];
  private defendPhrase: number | null = null;
  /** Per target index of the current defend phrase: the planned click, or null when the bot lets it pass. */
  private defendPlan = new Map<number, PlannedClick | null>();
  private walkX = 0.5;
  private walkY = 0.5;

  constructor(
    private readonly session: DuelSession,
    private readonly deps: { clock: Clock; grid: BeatGrid; tunables: Tunables },
    options: Partial<BotOptions> = {},
  ) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      strikes: [...(options.strikes ?? DEFAULT_OPTIONS.strikes)],
    };
    this.rng = mulberry32(this.options.seed);
  }

  update(): void {
    const view = this.session.view();
    const now = this.deps.clock.now();
    if (view.phase === 'attack' && view.localActive) {
      this.attack(view.clockPhrase, now);
    } else if (view.phase === 'defend' && view.localActive) {
      this.defend(view.clockPhrase, view.targets, now);
    }
  }

  private attack(phrase: number, now: number): void {
    if (this.attackPhrase !== phrase) {
      this.attackPhrase = phrase;
      this.attackPlan = this.planAttack(phrase);
    }
    for (const c of this.attackPlan) {
      if (!c.fired && now >= c.time) {
        c.fired = true;
        this.session.pointerDown(c.x, c.y, c.time, false);
      }
    }
  }

  private planAttack(phrase: number): PlannedClick[] {
    const t = this.deps.tunables;
    const spp = slotsPerPhrase(t);
    const [lo, hi] = this.options.strikes;
    const minCount = Math.max(0, Math.min(lo, hi));
    const maxCount = Math.min(spp, Math.max(lo, hi));
    const count = Math.max(0, Math.min(spp, minCount + Math.floor(this.rng() * (maxCount - minCount + 1))));

    // Choose `count` distinct slots (partial Fisher-Yates), then sort so plants go in time order.
    const slots = Array.from({ length: spp }, (_, i) => i);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(this.rng() * (spp - i));
      const tmp = slots[i] as number;
      slots[i] = slots[j] as number;
      slots[j] = tmp;
    }
    const chosen = slots.slice(0, count).sort((a, b) => a - b);

    const plan: PlannedClick[] = [];
    for (const slot of chosen) {
      this.stepWalk();
      plan.push({
        time: slotTime(this.deps.grid, phrase, slot, t),
        x: this.walkX,
        y: this.walkY,
        fired: false,
      });
    }
    return plan;
  }

  /** Move the random walk by 0.15..0.45 play-area widths in a random direction, staying inside the bounds. */
  private stepWalk(): void {
    const aspect = this.deps.tunables.playAreaAspect;
    const dist = STEP_MIN + this.rng() * (STEP_MAX - STEP_MIN);
    const angle = this.rng() * Math.PI * 2;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    this.walkX = clamp(this.walkX + dist * Math.cos(angle), X_MIN, X_MAX);
    // y fractions span `aspect` widths per unit.
    this.walkY = clamp(this.walkY + dist * Math.sin(angle) * aspect, Y_MIN, Y_MAX);
  }

  private defend(
    phrase: number,
    targets: { index: number; strike: { slot: number; x: number; y: number } }[],
    now: number,
  ): void {
    if (this.defendPhrase !== phrase) {
      this.defendPhrase = phrase;
      this.defendPlan = new Map();
    }
    for (const target of targets) {
      if (!this.defendPlan.has(target.index)) {
        this.defendPlan.set(target.index, this.planParry(phrase, target.strike));
      }
      const plan = this.defendPlan.get(target.index);
      if (plan && !plan.fired && now >= plan.time) {
        plan.fired = true;
        this.session.pointerDown(plan.x, plan.y, plan.time, false);
      }
    }
  }

  private planParry(phrase: number, strike: { slot: number; x: number; y: number }): PlannedClick | null {
    const t = this.deps.tunables;
    if (this.rng() >= this.options.accuracy) return null;
    const bravo = this.rng() < this.options.bravoRate;
    const u = this.rng();
    // Bravo: inside 80% of the Bravo window. Otherwise strictly between the Bravo edge and 80% of the Good window,
    // which keeps clear of the window edges. (The session's input grace now absorbs a late-handled frame, so the margin
    // is only for edge safety; it is left at 80%.)
    const goodReach = WINDOW_SAFETY * t.goodWindowMs;
    const magnitudeMs = bravo
      ? u * WINDOW_SAFETY * t.bravoWindowMs
      : t.bravoWindowMs + (0.1 + 0.9 * u) * (goodReach - t.bravoWindowMs);
    const sign = this.rng() < 0.5 ? -1 : 1;
    const time = slotTime(this.deps.grid, phrase, strike.slot, t) + (sign * magnitudeMs) / 1000;
    return { time, x: strike.x, y: strike.y, fired: false };
  }
}

export interface BotOpponent {
  /** The human player's end of the link (role 'host'). */
  transport: Transport;
  readonly session: DuelSession; // the bot's own session, player 1
  readonly driver: BotDriver;
  /** Call every frame: updates the bot's session and driver. */
  update(): void;
  dispose(): void;
}

/** Loopback pair + the bot's session as player 1 + a driver. */
export function createBotOpponent(deps: {
  clock: Clock;
  grid: BeatGrid;
  tunables: Tunables;
  firstAttacker: PlayerId;
  firstPhrase: number;
  options?: Partial<BotOptions>;
}): BotOpponent {
  const pair = createLoopbackPair();
  const session = new DuelSession({
    localPlayer: 1,
    clock: deps.clock,
    grid: deps.grid,
    transport: pair.guest,
    tunables: deps.tunables,
    firstAttacker: deps.firstAttacker,
    firstPhrase: deps.firstPhrase,
  });
  const driver = new BotDriver(
    session,
    { clock: deps.clock, grid: deps.grid, tunables: deps.tunables },
    deps.options,
  );
  return {
    transport: pair.host,
    session,
    driver,
    update() {
      session.update();
      driver.update();
    },
    dispose() {
      session.dispose();
      pair.host.close();
    },
  };
}
