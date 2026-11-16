import { phraseStart, slotTime, slotsPerPhrase } from '../core/beat';
import { otherPlayer } from '../core/duel';
import { DuelSession } from '../core/session';
import type { BeatGrid, Clock, PlayerId, Transport, Tunables } from '../core/types';
import { createLoopbackPair } from './loopback';
import { tiredness, type BotDifficulty } from './botDifficulty';
import { X_MAX, X_MIN, Y_MAX, Y_MIN, type PatternName } from './botPatterns';
import { chooseAttack } from './botStrategy';

/** What a caller may set. */
export interface BotOptions {
  /** The level: attack patterns, parry chance and Bravo share (see botDifficulty.ts). Default 'medium'. */
  difficulty: BotDifficulty;
  /**
   * Chance of parrying each strike, 0..1. When given, it is used as a constant (no tiredness); otherwise the
   * level's chance, sliding down over each act.
   */
  accuracy: number;
  /** Of successful parries, the share that are Bravo. Constant when given, like `accuracy`. */
  bravoRate: number;
  /**
   * Strikes per attack phrase, inclusive range. When given, the bot ignores the patterns and plants that many
   * strikes on a random walk, whether or not it can afford them (a stress setting for tests).
   */
  strikes: [number, number];
  /** Seed for the bot's deterministic random generator. Default 1. */
  seed: number;
}

/** The options as the driver holds them: `accuracy` and `bravoRate` always read a number (the live value). */
export interface BotDriverOptions {
  difficulty: BotDifficulty;
  /** Reads the parry chance in force now; writing it fixes the chance at that value. */
  accuracy: number;
  /** Reads the Bravo share in force now; writing it fixes the share at that value. */
  bravoRate: number;
  strikes?: [number, number];
  seed: number;
}

/** Free-form walk step lengths, in play-area widths (only used with an explicit `strikes` range). */
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
  readonly options: BotDriverOptions;
  /** The pattern of the current attack phrase ('free' for the explicit-strikes walk), or null before the first. */
  pattern: PatternName | 'free' | null = null;
  private readonly rng: () => number;
  private accuracyOverride: number | null;
  private bravoOverride: number | null;
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
    this.accuracyOverride = options.accuracy ?? null;
    this.bravoOverride = options.bravoRate ?? null;
    this.rng = mulberry32(options.seed ?? 1);
    const o = { difficulty: options.difficulty ?? 'medium', seed: options.seed ?? 1 } as BotDriverOptions;
    if (options.strikes) o.strikes = [options.strikes[0], options.strikes[1]];
    Object.defineProperties(o, {
      accuracy: {
        enumerable: true,
        get: () => this.parryChance(),
        set: (v: number) => {
          this.accuracyOverride = v;
        },
      },
      bravoRate: {
        enumerable: true,
        get: () => this.bravoShare(),
        set: (v: number) => {
          this.bravoOverride = v;
        },
      },
    });
    this.options = o;
  }

  /** The level's parry chance and Bravo share now: fresh at the start of each act, tired later in it. */
  private currentTiredness(): { accuracy: number; bravoRate: number } {
    const t = this.deps.tunables;
    const sinceActStart =
      this.deps.clock.now() - phraseStart(this.deps.grid, this.session.state.actFirstPhrase, t);
    return tiredness(this.options.difficulty, Math.max(0, sinceActStart), t.actDurationSec);
  }

  /** The chance of parrying a strike right now. */
  parryChance(): number {
    return this.accuracyOverride ?? this.currentTiredness().accuracy;
  }

  /** Of parries right now, the share that are Bravo. */
  bravoShare(): number {
    return this.bravoOverride ?? this.currentTiredness().bravoRate;
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
      if (this.options.strikes === undefined) {
        // Plan from the settled state: wait for the previous phrase's resolve (stamina regeneration) to land.
        const s = this.session.state;
        if (s.phase !== 'attack' || s.phrase !== phrase) return;
      }
      this.attackPhrase = phrase;
      this.attackPlan =
        this.options.strikes === undefined ? this.planPattern(phrase) : this.planAttack(phrase);
    }
    for (const c of this.attackPlan) {
      if (!c.fired && now >= c.time) {
        c.fired = true;
        this.session.pointerDown(c.x, c.y, c.time, false);
      }
    }
  }

  /** One named pattern, trimmed so the rules accept every strike. */
  private planPattern(phrase: number): PlannedClick[] {
    const t = this.deps.tunables;
    const players = this.session.state.players;
    const me = this.session.view().localPlayer;
    const chosen = chooseAttack(this.options.difficulty, {
      rng: this.rng,
      tunables: t,
      start: { x: this.walkX, y: this.walkY },
      me: players[me],
      opp: players[otherPlayer(me)],
    });
    this.pattern = chosen.pattern;
    const last = chosen.strikes[chosen.strikes.length - 1];
    if (last) {
      this.walkX = last.x;
      this.walkY = last.y;
    }
    return chosen.strikes.map((s) => ({
      time: slotTime(this.deps.grid, phrase, s.slot, t),
      x: s.x,
      y: s.y,
      fired: false,
    }));
  }

  /** The free-form plan: a random count of random slots on a random walk (explicit `strikes` only). */
  private planAttack(phrase: number): PlannedClick[] {
    this.pattern = 'free';
    const t = this.deps.tunables;
    const spp = slotsPerPhrase(t);
    const [lo, hi] = this.options.strikes ?? [3, 6];
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
    if (this.rng() >= this.parryChance()) return null;
    const bravo = this.rng() < this.bravoShare();
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
