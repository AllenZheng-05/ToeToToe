import type { DuelSession } from '../core/session';
import type { BeatGrid, PlayerId, Transport } from '../core/types';

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
  /** The bot's live options, so the debug overlay can edit its accuracy. */
  bot?: { options: { accuracy: number } };
}

export interface Scene {
  enter(): void | Promise<void>;
  exit(): void;
}
