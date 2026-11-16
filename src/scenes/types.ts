import type { DuelSession } from '../core/session';
import type { BeatGrid, PlayerId, Transport, Unsubscribe } from '../core/types';

/** The three part images of one puppet (at the PARTS sizes): canvases, bitmaps or images. */
export interface PuppetImagesSource {
  head: CanvasImageSource;
  sock: CanvasImageSource;
  sword: CanvasImageSource;
}

export interface MatchSetup {
  localPlayer: PlayerId;
  /** Display names, index = PlayerId. */
  names: [string, string];
  transport: Transport;
  grid: BeatGrid;
  firstAttacker: PlayerId;
  firstPhrase: number;
  /** Called every frame before the local session's update (the bot opponent hooks in here). */
  tick?: () => void;
  /** Called once when the duel scene is left. Stop music, dispose the opponent. */
  dispose?: () => void;
  /** Called when the player asks for a rematch on the victory screen; resolves to the next setup. */
  rematch?: () => Promise<MatchSetup>;
  /** Called once with the local session right after the duel scene creates it (autoplay hooks in here). */
  attach?: (session: DuelSession) => void;
  /** True for a match played through a Room (two people), false for the bot. */
  online?: boolean;
  /** Room matches: reports whether each side has asked for a rematch (called once now, then on every change). */
  watchRematch?: (cb: (s: { local: boolean; peer: boolean }) => void) => Unsubscribe;
  /** Room matches: leave the room for good (closes the connection, restores the address bar). */
  leave?: () => void;
  /**
   * Drawings of the two puppets, index = PlayerId. A missing side (or the whole field) means the
   * duel picks them: the local player's selected puppet, and the pink preset (teal if the local
   * player chose pink) for the opponent. Drawings from the other player fill this in later.
   */
  puppets?: [PuppetImagesSource | null, PuppetImagesSource | null];
  /** The bot's live options, so the debug overlay can edit its accuracy. */
  bot?: { options: { accuracy: number } };
}

export interface Scene {
  enter(): void | Promise<void>;
  exit(): void;
}
