import type { CardDefinition, CardInstance, GameState } from './types';

export interface BattlefieldEntryOptions {
  forceTapped?: boolean;
  defaultTapped?: boolean;
  payLifeToEnterUntapped?: boolean;
  summoningSick?: boolean;
  choices?: CardInstance['choices'];
}

export interface BattlefieldEntryPlan {
  card: CardInstance;
  players: GameState['players'];
  tapped: boolean;
  paidLife: number;
  optionalLifeCost?: number;
}

/** Parses "you may pay N life. If you don't, it enters tapped" entry choices. */
export function getOptionalUntappedLifeCost(oracleText: string): number | undefined {
  if (!oracleText) return undefined;
  const lower = oracleText.toLowerCase();
  const match = lower.match(/\byou may pay\s+(\d+)\s+life\b[^.]*\.\s*if\s+you\s+don'?t\b[^.]*enters?\s+tapped/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Check if a permanent's oracle text indicates it enters the battlefield tapped. */
export function entersTheBattlefieldTapped(oracleText: string): boolean {
  if (!oracleText) return false;
  const lower = oracleText.toLowerCase();
  // If any clause says "doesn't enter" or "does not enter" tapped, treat as not-always-tapped.
  if (/\bdo(?:es)?n'?t\s+enter\s+(?:the\s+battlefield\s+)?tapped\b/.test(lower)) return false;
  if (/\bdoes\s+not\s+enter\s+(?:the\s+battlefield\s+)?tapped\b/.test(lower)) return false;
  // Until the UI can prompt for optional life payments, default shock lands to tapped.
  if (/\bif\s+you\s+don'?t\b[^.]*enters?\s+tapped/.test(lower)) return true;
  // Otherwise, look for affirmative "enters tapped" / "enters the battlefield tapped".
  return /\benters?(?:\s+the\s+battlefield)?\s+tapped\b/.test(lower);
}

export function buildBattlefieldEntryPlan(
  state: GameState,
  controllerId: string,
  card: CardInstance,
  def: CardDefinition,
  options: BattlefieldEntryOptions = {},
): BattlefieldEntryPlan {
  const optionalLifeCost = getOptionalUntappedLifeCost(def.oracle_text);
  let tapped = Boolean(options.defaultTapped) || entersTheBattlefieldTapped(def.oracle_text);
  let paidLife = 0;

  if (options.forceTapped) {
    tapped = true;
  } else if (optionalLifeCost !== undefined) {
    if (options.payLifeToEnterUntapped) {
      const player = state.players.find(p => p.id === controllerId);
      if (!player || player.life < optionalLifeCost) {
        throw new Error('Cannot pay life for permanent entry');
      }
      tapped = false;
      paidLife = optionalLifeCost;
    } else {
      tapped = true;
    }
  }

  const players = paidLife > 0
    ? state.players.map(player =>
        player.id === controllerId
          ? { ...player, life: player.life - paidLife }
          : player,
      )
    : state.players;

  return {
    card: {
      ...card,
      zone: 'battlefield',
      tapped,
      summoningSick: options.summoningSick ?? true,
      damage: 0,
      choices: options.choices,
    },
    players,
    tapped,
    paidLife,
    optionalLifeCost,
  };
}
