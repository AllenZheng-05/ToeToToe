import type { DuelView, PlayerId, Strike, Tunables } from '../core/types';
import type { Rgb } from '../puppet/colour';
import type { Point } from '../puppet/parts';
import { solveRig } from '../puppet/rig';
import { createPlayerMarkTextures, MarksView, type PlayerMarkTextures } from './art/marks';
import { PuppetView, type PuppetImages } from './art/puppetView';
import { DESIGN_H, DESIGN_W, playToDesign } from './layout';
import type { Stage } from './stage';

/** Where each puppet's first segment sits, behind the ledge (design px). */
export const PUPPET_BASE: readonly [Point, Point] = [
  { x: 330, y: 675 },
  { x: 950, y: 675 },
];
/** Sword tip of a puppet nobody is steering. */
export const IDLE_TIP: readonly [Point, Point] = [
  { x: 668, y: 436 },
  { x: 612, y: 446 },
];
/** The puppet on the left faces right; the one on the right faces left, on every player's screen. */
export const FACING = [1, -1] as const;
/** How fast the opponent's tip eases toward its focus, per second. */
const EASE_RATE = 10;
/**
 * Turns a DuelView into stage updates: two jointed puppets, the strike discs and the targets.
 * Holds no rules: it only reads the view. Sprites and textures are created once and reused.
 */
export class DuelRenderer {
  private readonly marks: MarksView;
  private readonly views: (PuppetView | null)[] = [null, null];
  private readonly counts: (number | undefined)[] = [undefined, undefined];
  private readonly tips: [Point, Point] = [{ ...IDLE_TIP[0] }, { ...IDLE_TIP[1] }];
  private pointer: Point | null = null;
  private focus: Point | null = null;
  private touch = false;
  private lastPhase: DuelView['phase'] | null = null;
  private markSets: [PlayerMarkTextures, PlayerMarkTextures] | null = null;

  constructor(
    private readonly stage: Stage,
    private readonly tunables: Tunables,
    private readonly bpm: number,
  ) {
    this.marks = new MarksView(stage.markTextures);
    stage.marks.addChild(this.marks.container);
  }

  /**
   * Each player's mark colour (index = PlayerId), once per match. Bakes both players' disc textures.
   */
  setMarkColours(colours: [Rgb, Rgb]): void {
    this.markSets?.[0].destroy();
    this.markSets?.[1].destroy();
    const sets: [PlayerMarkTextures, PlayerMarkTextures] = [
      createPlayerMarkTextures(colours[0]),
      createPlayerMarkTextures(colours[1]),
    ];
    this.markSets = sets;
    this.marks.setPlayers(sets, colours);
  }

  /** The two puppets' drawings, index = PlayerId. Until this is called no puppet is drawn. */
  setPuppets(images: readonly [PuppetImages, PuppetImages]): void {
    for (const id of [1, 0] as const) {
      this.views[id]?.destroy();
      const view = new PuppetView(images[id], FACING[id]);
      this.views[id] = view;
      this.stage.puppets.addChild(view.container);
    }
    this.counts[0] = undefined;
    this.counts[1] = undefined;
  }

  /**
   * Local pointer position in design pixels (kept on the stage), or null when unknown. `touch` is whether
   * it came from a finger: the targets are drawn at the larger touch radius the rules judge with.
   * A lifted finger sends nothing, so the sword tip stays where the finger left it.
   */
  setPointer(p: Point | null, touch = false): void {
    this.pointer = p
      ? { x: Math.min(DESIGN_W, Math.max(0, p.x)), y: Math.min(DESIGN_H, Math.max(0, p.y)) }
      : null;
    this.touch = touch;
  }

  /** The opponent's tip eases toward this strike or target (play-area fractions). */
  setOpponentFocus(strike: Pick<Strike, 'x' | 'y'>): void {
    this.focus = playToDesign(strike.x, strike.y);
  }

  draw(view: DuelView, dtSec: number): void {
    const local = view.localPlayer;
    const opp: PlayerId = local === 0 ? 1 : 0;

    // A new act or count-in starts with the opponent at rest.
    if (view.phase !== this.lastPhase) {
      if (view.phase === 'countIn' || view.phase === 'intermission') this.focus = null;
      this.lastPhase = view.phase;
    }

    const k = 1 - Math.exp(-EASE_RATE * Math.max(0, dtSec));
    const goal = this.focus ?? IDLE_TIP[opp];
    const tipO = this.tips[opp];
    tipO.x += (goal.x - tipO.x) * k;
    tipO.y += (goal.y - tipO.y) * k;

    const tipL = this.tips[local];
    const rest = IDLE_TIP[local];
    tipL.x = this.pointer ? this.pointer.x : rest.x;
    tipL.y = this.pointer ? this.pointer.y : rest.y;

    for (const id of [0, 1] as const) {
      const pv = this.views[id];
      if (!pv) continue;
      const pose = solveRig(PUPPET_BASE[id], this.tips[id], FACING[id], this.counts[id]);
      this.counts[id] = pose.segmentCount;
      pv.setPose(pose);
    }

    this.marks.update(view, this.tunables, this.bpm, { touch: this.touch });
  }

  destroy(): void {
    this.marks.container.removeFromParent();
    this.marks.destroy();
    this.markSets?.[0].destroy();
    this.markSets?.[1].destroy();
    this.markSets = null;
    for (const v of this.views) v?.destroy();
    this.views[0] = null;
    this.views[1] = null;
  }
}
