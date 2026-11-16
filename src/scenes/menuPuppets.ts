import type { App } from '../app/app';
import type { PlayerId, Unsubscribe } from '../core/types';
import type { Point } from '../puppet/parts';
import { solveRig } from '../puppet/rig';
import { FACING, IDLE_TIP, PUPPET_BASE } from '../stage/duelRenderer';
import { DESIGN_W } from '../stage/layout';
import { PRESETS } from '../puppet/presets';
import { loadPresetImages, PuppetView, type PuppetImages } from '../stage/art/puppetView';
import { decodeDrawing, loadSelectedPuppet } from '../workshop/selection';

export type PuppetMood = 'idle' | 'win' | 'lose';

/** Where a left-hand puppet's sword tip goes in each mood; the right-hand puppet mirrors it. */
const MOOD_TIP: Record<PuppetMood, Point> = {
  idle: IDLE_TIP[0],
  win: { x: 632, y: 372 },
  lose: { x: 600, y: 590 },
};
/** How fast a tip eases toward its goal, per second. Animation only, not on the beat. */
const EASE_RATE = 9;
/** A tip this close to its goal is left alone. */
const SETTLED_PX = 0.05;
/** The pointer-following tip stays inside the stage between the curtains. */
const FOLLOW_MIN = { x: 230, y: 250 };
const FOLLOW_MAX = { x: 1050, y: 580 };

function tipFor(slot: PlayerId, mood: PuppetMood): Point {
  if (mood === 'idle') return { ...IDLE_TIP[slot] };
  const t = MOOD_TIP[mood];
  return slot === 0 ? { ...t } : { x: DESIGN_W - t.x, y: t.y };
}

interface Slot {
  view: PuppetView | null;
  tip: Point;
  mood: PuppetMood;
  posed: boolean;
  /** Body segments of the last pose, so the count changes with some hysteresis. */
  count: number | undefined;
}

/**
 * The two puppets of a menu screen standing on the stage (title, lobby, victory). Index = PlayerId:
 * 0 on the left, 1 on the right. They sit at the duel's own positions, swords crossed until a mood
 * says otherwise. One puppet's sword tip can follow the pointer. Reads nothing from the match.
 */
export class MenuPuppets {
  private readonly slots: [Slot, Slot] = [
    { view: null, tip: tipFor(0, 'idle'), mood: 'idle', posed: false, count: undefined },
    { view: null, tip: tipFor(1, 'idle'), mood: 'idle', posed: false, count: undefined },
  ];
  private follow: PlayerId | null = null;
  private pointer: Point | null = null;
  private lastStamp = 0;
  private readonly unsubs: Unsubscribe[] = [];
  private readonly onMove = (e: PointerEvent): void => {
    const { scale, offsetX, offsetY } = this.app.stage.fit;
    this.pointer = { x: (e.clientX - offsetX) / scale, y: (e.clientY - offsetY) / scale };
  };

  constructor(private readonly app: App) {
    window.addEventListener('pointermove', this.onMove);
    this.unsubs.push(app.onFrame((info) => this.frame(info.timestamp)));
  }

  /** Show a puppet's drawings in a slot, or take the puppet away with null. */
  setImages(slot: PlayerId, images: PuppetImages | null): void {
    const s = this.slots[slot];
    s.view?.destroy();
    s.view = null;
    s.posed = false;
    s.count = undefined;
    if (!images) return;
    const view = new PuppetView(images, FACING[slot]);
    s.view = view;
    this.app.stage.puppets.addChild(view.container);
  }

  has(slot: PlayerId): boolean {
    return this.slots[slot].view !== null;
  }

  /** Where a puppet's sword goes: crossed (idle), raised (win) or dropped (lose). `instant` skips the easing. */
  setMood(slot: PlayerId, mood: PuppetMood, instant = false): void {
    const s = this.slots[slot];
    s.mood = mood;
    if (instant) {
      s.tip = tipFor(slot, mood);
      s.posed = false;
    }
  }

  /** The sword tip of this puppet follows the pointer (null: none does). */
  followPointer(slot: PlayerId | null): void {
    this.follow = slot;
  }

  private frame(timestamp: number): void {
    const dt = this.lastStamp > 0 ? Math.min(0.1, (timestamp - this.lastStamp) / 1000) : 0;
    this.lastStamp = timestamp;
    const k = 1 - Math.exp(-EASE_RATE * dt);
    for (const slot of [0, 1] as const) {
      const s = this.slots[slot];
      if (!s.view) continue;
      let goal = tipFor(slot, s.mood);
      if (this.follow === slot && this.pointer) {
        goal = {
          x: Math.min(FOLLOW_MAX.x, Math.max(FOLLOW_MIN.x, this.pointer.x)),
          y: Math.min(FOLLOW_MAX.y, Math.max(FOLLOW_MIN.y, this.pointer.y)),
        };
      }
      const dx = goal.x - s.tip.x;
      const dy = goal.y - s.tip.y;
      if (s.posed && Math.abs(dx) < SETTLED_PX && Math.abs(dy) < SETTLED_PX) continue;
      s.tip.x += dx * k;
      s.tip.y += dy * k;
      const pose = solveRig(PUPPET_BASE[slot], s.tip, FACING[slot], s.count);
      s.count = pose.segmentCount;
      s.view.setPose(pose);
      s.posed = true;
    }
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onMove);
    for (const off of this.unsubs.splice(0)) off();
    for (const s of this.slots) {
      s.view?.destroy();
      s.view = null;
    }
  }
}

/** The local player's selected puppet, decoded, with its name and preset id (null for a drawn puppet). Never rejects. */
export async function loadLocalPuppet(
  app: App,
): Promise<{ images: PuppetImages; name: string; presetId: string | null } | null> {
  try {
    const drawing = await loadSelectedPuppet(app.store);
    return { images: await decodeDrawing(drawing), name: drawing.name, presetId: drawing.presetId ?? null };
  } catch {
    return null;
  }
}

/** A preset puppet to stand opposite the player: pink, or teal when the player chose pink. Never rejects. */
export async function loadPartnerPuppet(playerPresetId: string | null): Promise<PuppetImages | null> {
  const pink = PRESETS.find((p) => p.id === 'preset-pink') ?? PRESETS[1];
  const teal = PRESETS[0];
  const preset = playerPresetId !== null && playerPresetId === pink?.id ? teal : pink;
  if (!preset) return null;
  try {
    return await loadPresetImages(preset);
  } catch {
    return null;
  }
}

/**
 * The images to show for the friend's puppet. When both players kept the default teal sock the friend's is
 * shown as the pink preset (display only; nothing is sent). Otherwise the friend's own drawings. Never rejects.
 */
export async function peerPuppetForDisplay(
  peer: { name: string; images: PuppetImages },
  localPresetId: string | null,
): Promise<PuppetImages> {
  const teal = PRESETS[0];
  const pink = PRESETS.find((p) => p.id === 'preset-pink') ?? PRESETS[1];
  if (!teal || !pink || localPresetId !== teal.id || peer.name !== teal.name) return peer.images;
  try {
    return await loadPresetImages(pink);
  } catch {
    return peer.images;
  }
}
