import type { CardDefinition, CardInstance, GameState } from './types';
import { playerCanPayLife } from './game-outcome';
import { typeLineHasSupertype, typeLineHasType } from './type-line';

export interface BattlefieldEntryOptions {
  forceTapped?: boolean;
  defaultTapped?: boolean;
  payLifeToEnterUntapped?: boolean;
  /**
   * Slice 6 (shock-land auto-choice): when true AND payLifeToEnterUntapped is
   * undefined, buildBattlefieldEntryPlan applies a deterministic heuristic —
   * pay 2 life and enter untapped if the controller's life >= 4; otherwise enter
   * tapped.  The caller is responsible for routing the paid life through
   * executeLoseLife so LifeLoss triggers fire.  Only playLand() sets this flag;
   * executor / authority paths that use explicit payLifeToEnterUntapped do not.
   */
  autoChooseShockLand?: boolean;
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
  const match = lower.match(/\byou may pay\s+(\d+)\s+life\b[^.]*\.\s*if\s+you\s+don'?t\b[^.]*enters?(?:\s+the\s+battlefield)?\s+tapped/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Check if a permanent's oracle text indicates it enters the battlefield tapped. */
export function entersTheBattlefieldTapped(oracleText: string): boolean {
  if (!oracleText) return false;
  const lower = oracleText.toLowerCase();
  // If any clause says "doesn't enter" or "does not enter" tapped, treat as not-always-tapped.
  if (/\bdo(?:es)?n'?t\s+enter\s+(?:the\s+battlefield\s+)?tapped\b/.test(lower)) return false;
  if (/\bdoes\s+not\s+enter\s+(?:the\s+battlefield\s+)?tapped\b/.test(lower)) return false;
  // Lands such as Rejuvenating Springs have conditional opponent-count entry.
  // The actual condition is evaluated by buildBattlefieldEntryPlan.
  if (/\benters?(?:\s+the\s+battlefield)?\s+tapped\s+unless\s+you\s+have\s+two\s+or\s+more\s+opponents\b/.test(lower)) {
    return false;
  }
  // Supported control-count "enters tapped unless you control ..." conditions are
  // evaluated at entry by buildBattlefieldEntryPlan, so they are not always-tapped.
  if (parseConditionalEntersTapped(oracleText)) {
    return false;
  }
  // Shock-land form ("you may pay N life. If you don't, it enters tapped") is now
  // honestly evaluated by buildBattlefieldEntryPlan with a deterministic auto-choice
  // (pay when life >= 4, else enter tapped), so it is NOT always-tapped.
  if (/\byou\s+may\s+pay\s+\d+\s+life\b[^.]*\.\s*if\s+you\s+don'?t\b[^.]*enters?\s+tapped/i.test(oracleText)) return false;
  // Otherwise, look for affirmative "enters tapped" / "enters the battlefield tapped".
  return /\benters?(?:\s+the\s+battlefield)?\s+tapped\b/.test(lower);
}

function entersTappedUnlessTwoOrMoreOpponents(oracleText: string): boolean {
  return /\benters?(?:\s+the\s+battlefield)?\s+tapped\s+unless\s+you\s+have\s+two\s+or\s+more\s+opponents\b/i.test(oracleText);
}

function hasTwoOrMoreOpponents(state: GameState, controllerId: string): boolean {
  return state.players.filter(player => player.id !== controllerId && !player.hasLost).length >= 2;
}

/**
 * Simple control-count "enters tapped unless ..." conditions that the engine can
 * HONESTLY evaluate at entry by counting the permanents the controller already
 * controls. These mirror the executor's control convention (a card is controlled
 * by `ownerId` while on the battlefield) used by evaluateCondition.
 *
 * Supported forms (the land enters tapped only when the condition is FALSE):
 *   - "unless you control a basic land"                    → basics you control >= 1
 *   - "unless you control N or more basic lands"           → basics you control >= N
 *   - "unless you control two/three/... or more basic lands"
 *   - "unless you control N or fewer other lands"          → other lands you control <= N
 *     (slow lands such as Deserted Beach: "unless you control two or fewer other lands")
 *
 * Any other / more complex "unless" form returns undefined and is NOT claimed —
 * the caller falls back to existing behavior (so we never mis-evaluate).
 */
type ConditionalTappedCondition =
  | { kind: 'basicLandsAtLeast'; count: number }
  | { kind: 'otherLandsAtMost'; count: number };

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCountWord(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const numeric = parseInt(token, 10);
  if (!Number.isNaN(numeric)) return numeric;
  const word = WORD_NUMBERS[token.toLowerCase()];
  return word;
}

/** Parse the supported control-count "enters tapped unless ..." condition, or undefined. */
export function parseConditionalEntersTapped(oracleText: string): ConditionalTappedCondition | undefined {
  if (!oracleText) return undefined;
  const lower = oracleText.toLowerCase();
  // Must be an affirmative "enters tapped unless you control ..." clause.
  if (!/\benters?(?:\s+the\s+battlefield)?\s+tapped\s+unless\s+you\s+control\b/.test(lower)) {
    return undefined;
  }

  // "unless you control a/an basic land" → at least 1 basic land.
  if (/\bunless\s+you\s+control\s+(?:a|an)\s+basic\s+land\b/.test(lower)) {
    return { kind: 'basicLandsAtLeast', count: 1 };
  }

  // "unless you control N (or more) basic lands"
  const basicMatch = lower.match(
    /\bunless\s+you\s+control\s+([a-z]+|\d+)\s+or\s+more\s+basic\s+lands\b/,
  );
  if (basicMatch) {
    const n = parseCountWord(basicMatch[1]);
    if (n !== undefined && n >= 1) return { kind: 'basicLandsAtLeast', count: n };
    return undefined;
  }

  // "unless you control N or fewer other lands" (slow lands)
  const fewerMatch = lower.match(
    /\bunless\s+you\s+control\s+([a-z]+|\d+)\s+or\s+fewer\s+other\s+lands\b/,
  );
  if (fewerMatch) {
    const n = parseCountWord(fewerMatch[1]);
    if (n !== undefined && n >= 0) return { kind: 'otherLandsAtMost', count: n };
    return undefined;
  }

  return undefined;
}

function isBasicLandDef(def: CardDefinition | undefined): boolean {
  if (!def) return false;
  const isLand = def.card_types.includes('land') || typeLineHasType(def.type_line, 'land');
  return isLand && typeLineHasSupertype(def.type_line, 'basic');
}

function isLandDef(def: CardDefinition | undefined): boolean {
  if (!def) return false;
  return def.card_types.includes('land') || typeLineHasType(def.type_line, 'land');
}

/**
 * Evaluate a supported control-count condition. Returns whether the land should
 * enter TAPPED (condition not met). The entering permanent itself is excluded
 * from the "other lands" count via `selfInstanceId`.
 */
function evaluateConditionalEntersTapped(
  state: GameState,
  controllerId: string,
  condition: ConditionalTappedCondition,
  selfInstanceId: string,
): boolean {
  if (condition.kind === 'basicLandsAtLeast') {
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== controllerId) continue;
      const def = state.cardDefinitions.get(card.definitionId);
      if (isBasicLandDef(def)) {
        count++;
        if (count >= condition.count) return false; // condition met → enters untapped
      }
    }
    return true; // not enough basics → enters tapped
  }
  // otherLandsAtMost
  let count = 0;
  for (const [, card] of state.cards) {
    if (card.zone !== 'battlefield') continue;
    if (card.ownerId !== controllerId) continue;
    if (card.instanceId === selfInstanceId) continue; // "other" lands
    const def = state.cardDefinitions.get(card.definitionId);
    if (isLandDef(def)) count++;
  }
  // Enters untapped when you control N or fewer other lands; tapped otherwise.
  return count > condition.count;
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

  const conditionalTapped = parseConditionalEntersTapped(def.oracle_text);

  if (options.forceTapped) {
    tapped = true;
  } else if (conditionalTapped) {
    tapped = Boolean(options.defaultTapped)
      || evaluateConditionalEntersTapped(state, controllerId, conditionalTapped, card.instanceId);
  } else if (entersTappedUnlessTwoOrMoreOpponents(def.oracle_text)) {
    tapped = Boolean(options.defaultTapped) || !hasTwoOrMoreOpponents(state, controllerId);
  } else if (optionalLifeCost !== undefined) {
    if (options.payLifeToEnterUntapped === true) {
      // Explicit opt-in (e.g. from authority search-to-battlefield): validate and pay.
      if (!playerCanPayLife(state, controllerId, optionalLifeCost)) {
        throw new Error('Cannot pay life for permanent entry');
      }
      tapped = false;
      paidLife = optionalLifeCost;
    } else if (options.payLifeToEnterUntapped === false) {
      // Explicit opt-out: enter tapped, no payment.
      tapped = true;
    } else if (options.autoChooseShockLand) {
      // Deterministic auto-choice (playLand only): pay if life >= 4, otherwise enter
      // tapped. Threshold of 4 avoids paying life when at or near lethal range and
      // ensures the land always untaps when the player is at a healthy life total.
      // Future prompts can replace this heuristic with a real player decision.
      // NOTE: the caller (playLand) is responsible for routing paidLife through
      // executeLoseLife so LifeLoss triggers (e.g. Sanguine Bond) fire correctly.
      const player = state.players.find(p => p.id === controllerId);
      const playerLife = player?.life ?? 0;
      if (playerCanPayLife(state, controllerId, optionalLifeCost) && playerLife >= 4) {
        tapped = false;
        paidLife = optionalLifeCost;
      } else {
        tapped = true;
      }
    } else {
      // No explicit choice and no auto-choose flag: enter tapped (safe default for
      // executor / authority / stack paths that do not yet handle life payments).
      tapped = true;
    }
  }

  // When payLifeToEnterUntapped is explicitly true, deduct life inline (legacy path
  // used by search-to-battlefield in authority/executor, which do not call
  // executeLoseLife). When auto-choice is used (undefined), the caller is responsible
  // for routing the loss through executeLoseLife so triggers fire.
  const players = (paidLife > 0 && options.payLifeToEnterUntapped === true)
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
      playableFromExileUntilTurn: undefined,
      playableFromExileSourceId: undefined,
      choices: options.choices,
    },
    players,
    tapped,
    paidLife,
    optionalLifeCost,
  };
}
