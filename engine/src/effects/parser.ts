// Phase 4: Oracle text parser
// Phase 10: Extended with modal, X costs, tokens, and more patterns
// Converts tokenized oracle text into Effect AST + required TargetSpecs

import { tokenizeOracleText } from './tokens';
import type { Effect, TriggeredAbility, TargetRef, SourceRef, TokenDefinition, AmountRef, ModalSpell, ModalChoice, ActivatedAbility, ActivatedAbilityCost, CardFilter } from './ast';
import type { TargetSpec, TargetType } from './targets';

export type ParsedOracle =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[]; xCost?: boolean }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Modal'; modal: ModalSpell; xCost?: boolean }
  | { kind: 'Dies'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Unparsed'; reason: string };

let targetSpecCounter = 0;

function makeTargetSpec(type: TargetType, constraints?: { opponentControls?: boolean }): TargetSpec {
  return {
    id: `target_${++targetSpecCounter}`,
    type,
    count: 1,
    constraints,
  };
}

function makeChosenRef(spec: TargetSpec): TargetRef {
  return { kind: 'Chosen', targetId: spec.id };
}

// Pattern matchers return [Effect[], TargetSpec[], tokensConsumed] or null

type PatternResult = { effects: Effect[]; targets: TargetSpec[]; consumed: number } | null;

/**
 * Match: "~ deals N damage to any target"
 * Match: "~ deals N damage to target creature"
 * Match: "~ deals N damage to target player"
 */
function matchDealDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // Pattern: ~ deals N damage to (any target | target creature | target player)
  // tokens: ["~", "deals", "3", "damage", "to", "any", "target"]
  // or:     ["~", "deals", "3", "damage", "to", "target", "creature"]

  if (slice.length < 6) return null;
  if (slice[0] !== '~') return null;
  if (slice[1] !== 'deals') return null;

  const amount = parseInt(slice[2], 10);
  if (isNaN(amount)) return null;

  if (slice[3] !== 'damage') return null;
  if (slice[4] !== 'to') return null;

  let targetType: TargetType;
  let consumed: number;

  // "any target"
  if (slice[5] === 'any' && slice[6] === 'target') {
    targetType = 'Any';
    consumed = 7;
  }
  // "target creature"
  else if (slice[5] === 'target' && slice[6] === 'creature') {
    targetType = 'Creature';
    consumed = 7;
  }
  // "target player"
  else if (slice[5] === 'target' && slice[6] === 'player') {
    targetType = 'Player';
    consumed = 7;
  }
  else {
    return null;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisSpell' } as SourceRef,
    target: makeChosenRef(spec),
    amount,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "destroy target creature"
 * Match: "destroy target creature an opponent controls"
 */
function matchDestroy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'target') return null;
  if (slice[2] !== 'creature') return null;

  let consumed = 3;
  let opponentControls = false;

  // Check for "an opponent controls"
  if (slice[3] === 'an' && slice[4] === 'opponent' && slice[5] === 'controls') {
    opponentControls = true;
    consumed = 6;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec('Creature', opponentControls ? { opponentControls: true } : undefined);
  const effect: Effect = {
    kind: 'Destroy',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "draw a card"
 * Match: "draw N cards"
 */
function matchDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'draw') return null;

  let count: number;
  let consumed: number;

  // "draw a card"
  if (slice[1] === 'a' && slice[2] === 'card') {
    count = 1;
    consumed = 3;
  }
  // "draw N cards"
  else {
    const n = parseInt(slice[1], 10);
    if (isNaN(n)) return null;
    if (slice[2] !== 'cards') return null;
    count = n;
    consumed = 3;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "gain N life"
 */
function matchGainLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'gain') return null;

  const amount = parseInt(slice[1], 10);
  if (isNaN(amount)) return null;

  if (slice[2] !== 'life') return null;

  let consumed = 3;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'GainLife',
    player: { kind: 'Controller' },
    amount,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "lose N life"
 */
function matchLoseLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'lose') return null;

  const amount = parseInt(slice[1], 10);
  if (isNaN(amount)) return null;

  if (slice[2] !== 'life') return null;

  let consumed = 3;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const effect: Effect = {
    kind: 'LoseLife',
    player: { kind: 'Controller' },
    amount,
  };

  return { effects: [effect], targets: [], consumed };
}


/**
 * Match: "each opponent loses N life"
 */
function matchEachOpponentLosesLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'loses') return null;

  const amount = parseInt(slice[3], 10);
  if (isNaN(amount)) return null;

  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'LoseLife',
    player: { kind: 'EachOpponent' },
    amount,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "each opponent discards a card"
 * Match: "each opponent discards N cards"
 */
function matchEachOpponentDiscardsCard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'discards') return null;

  let count: number;
  let consumed: number;

  if (slice[3] === 'a' && slice[4] === 'card') {
    count = 1;
    consumed = 5;
  } else {
    count = parseInt(slice[3], 10);
    if (isNaN(count)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
    consumed = 5;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Discard',
    player: { kind: 'EachOpponent' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "destroy all creatures"
 */
function matchDestroyAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'all') return null;
  if (slice[2] !== 'creatures') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllCreatures' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "exile target creature"
 * Match: "exile target permanent"
 */
function matchExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed = 3;

  if (slice[2] === 'creature') {
    targetType = 'Creature';
  } else if (slice[2] === 'permanent') {
    targetType = 'Any'; // Closest to permanent
  } else {
    return null;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'Exile',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return target creature to its owner's hand"
 */
function matchReturnToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'target') return null;
  if (slice[2] !== 'creature') return null;
  if (slice[3] !== 'to') return null;
  if (slice[4] !== 'its') return null;
  if (slice[5] !== "owner's" && slice[5] !== 'owners') return null;
  if (slice[6] !== 'hand') return null;

  let consumed = 7;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'ReturnToHand',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target player mills N cards"
 * Match: "mill N cards" (controller mills)
 */
function matchMill(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target player mills N cards"
  if (slice.length >= 5 && slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'mills') {
    const amount = parseInt(slice[3], 10);
    if (isNaN(amount)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;

    let consumed = 5;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const spec = makeTargetSpec('Player');
    const effect: Effect = {
      kind: 'Mill',
      player: makeChosenRef(spec),
      count: amount,
    };

    return { effects: [effect], targets: [spec], consumed };
  }

  // "mill N cards"
  if (slice.length >= 3 && slice[0] === 'mill') {
    const amount = parseInt(slice[1], 10);
    if (isNaN(amount)) return null;
    if (slice[2] !== 'cards' && slice[2] !== 'card') return null;

    let consumed = 3;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effect: Effect = {
      kind: 'Mill',
      player: { kind: 'Controller' },
      count: amount,
    };

    return { effects: [effect], targets: [], consumed };
  }

  return null;
}

/**
 * Match: "put a +1/+1 counter on target creature"
 * Match: "put N +1/+1 counters on target creature"
 */
function matchAddCounters(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'put') return null;

  let count: number;
  let counterStartIdx: number;

  // "put a +1/+1 counter"
  if (slice[1] === 'a') {
    count = 1;
    counterStartIdx = 2;
  }
  // "put N +1/+1 counters"
  else {
    const n = parseInt(slice[1], 10);
    if (isNaN(n)) return null;
    count = n;
    counterStartIdx = 2;
  }

  // Parse counter type (e.g., "+1/+1")
  const counterType = slice[counterStartIdx];
  if (!counterType) return null;

  // "counter" or "counters"
  const counterWord = slice[counterStartIdx + 1];
  if (counterWord !== 'counter' && counterWord !== 'counters') return null;

  if (slice[counterStartIdx + 2] !== 'on') return null;
  if (slice[counterStartIdx + 3] !== 'target') return null;
  if (slice[counterStartIdx + 4] !== 'creature') return null;

  let consumed = counterStartIdx + 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'AddCounters',
    target: makeChosenRef(spec),
    counterType,
    count,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "tap target creature"
 */
function matchTap(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'tap') return null;
  if (slice[1] !== 'target') return null;
  if (slice[2] !== 'creature') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'Tap',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "untap target creature"
 */
function matchUntap(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'untap') return null;
  if (slice[1] !== 'target') return null;
  if (slice[2] !== 'creature') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'Untap',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "create a N/N [color] [type] creature token"
 * Match: "create N N/N [color] [type] creature tokens"
 */
function matchCreateToken(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'create') return null;

  let tokenCount: number;
  let idx: number;

  // "create a" or "create N"
  if (slice[1] === 'a' || slice[1] === 'an') {
    tokenCount = 1;
    idx = 2;
  } else {
    const n = parseInt(slice[1], 10);
    if (isNaN(n)) return null;
    tokenCount = n;
    idx = 2;
  }

  // Parse P/T (e.g., "1/1", "2/2")
  const ptMatch = slice[idx]?.match(/^(\d+)\/(\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);
  idx++;

  // Parse optional color
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];
  const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  };
  while (colorMap[slice[idx]]) {
    colors.push(colorMap[slice[idx]]);
    idx++;
  }

  // Parse type (e.g., "goblin", "soldier", "spirit")
  const subtypes: string[] = [];
  while (slice[idx] && slice[idx] !== 'creature' && slice[idx] !== 'token' && slice[idx] !== 'tokens') {
    subtypes.push(slice[idx]);
    idx++;
  }

  // "creature token" or "creature tokens"
  if (slice[idx] !== 'creature') return null;
  idx++;
  if (slice[idx] !== 'token' && slice[idx] !== 'tokens') return null;
  idx++;

  // Handle trailing period
  if (slice[idx] === '.') idx++;

  const token: TokenDefinition = {
    name: subtypes.length > 0 ? subtypes.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') : 'Creature',
    colors,
    types: ['creature'],
    subtypes: subtypes.length > 0 ? subtypes : undefined,
    power,
    toughness,
  };

  const effect: Effect = {
    kind: 'CreateToken',
    controller: { kind: 'Controller' },
    token,
    count: tokenCount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "each opponent discards a card"
 * Match: "target player discards N cards"
 */
function matchDiscard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "target player discards N cards"
  if (slice.length >= 4 && slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'discards') {
    let count: number;
    let consumed: number;

    if (slice[3] === 'a') {
      count = 1;
      consumed = 5; // "target player discards a card"
    } else {
      count = parseInt(slice[3], 10);
      if (isNaN(count)) return null;
      consumed = 5; // "target player discards N cards"
    }

    if (tokens[startIndex + consumed] === '.') consumed++;

    const spec = makeTargetSpec('Player');
    const effect: Effect = {
      kind: 'Discard',
      player: makeChosenRef(spec),
      count,
    };

    return { effects: [effect], targets: [spec], consumed };
  }

  return null;
}

/**
 * Match: "scry N"
 */
function matchScry(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'scry') return null;

  const count = parseInt(slice[1], 10);
  if (isNaN(count)) return null;

  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Scry',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Match: "~ deals X damage to any target"
 */
function matchDealXDamage(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== '~') return null;
  if (slice[1] !== 'deals') return null;
  if (slice[2] !== 'x') return null;
  if (slice[3] !== 'damage') return null;
  if (slice[4] !== 'to') return null;

  let targetType: TargetType;
  let consumed: number;

  if (slice[5] === 'any' && slice[6] === 'target') {
    targetType = 'Any';
    consumed = 7;
  } else if (slice[5] === 'target' && slice[6] === 'creature') {
    targetType = 'Creature';
    consumed = 7;
  } else if (slice[5] === 'target' && slice[6] === 'player') {
    targetType = 'Player';
    consumed = 7;
  } else {
    return null;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisSpell' } as SourceRef,
    target: makeChosenRef(spec),
    amount: { kind: 'X' },
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "draw X cards"
 */
function matchDrawX(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'draw') return null;
  if (slice[1] !== 'x') return null;
  if (slice[2] !== 'cards') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count: { kind: 'X' },
  };

  return { effects: [effect], targets: [], consumed };
}

/**
 * Try to parse an effect clause starting at the given index.
 * Returns the first matching pattern.
 */
function parseEffectClause(tokens: string[], startIndex: number): PatternResult {
  // Try patterns in priority order (X patterns first)
  const patterns = [
    matchDealXDamage,
    matchDrawX,
    matchEachOpponentLosesLife,
    matchEachOpponentDiscardsCard,
    matchDestroyAll,
    matchDealDamage,
    matchDestroy,
    matchDraw,
    matchGainLife,
    matchLoseLife,
    matchExile,
    matchReturnToHand,
    matchMill,
    matchAddCounters,
    matchTap,
    matchUntap,
    matchCreateToken,
    matchDiscard,
    matchScry,
  ];

  for (const pattern of patterns) {
    const result = pattern(tokens, startIndex);
    if (result) return result;
  }

  return null;
}

/**
 * Check if tokens start with ETB trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchETBPrefix(tokens: string[]): number {
  // "when ~ enters the battlefield ,"
  // "whenever ~ enters the battlefield ,"

  if (tokens.length < 6) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  if (tokens[1] !== '~') return -1;
  if (tokens[2] !== 'enters') return -1;
  if (tokens[3] !== 'the') return -1;
  if (tokens[4] !== 'battlefield') return -1;

  // Optional comma
  let idx = 5;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with dies trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchDiesPrefix(tokens: string[]): number {
  // "when ~ dies ,"
  // "whenever ~ dies ,"

  if (tokens.length < 4) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  if (tokens[1] !== '~') return -1;
  if (tokens[2] !== 'dies') return -1;

  // Optional comma
  let idx = 3;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if mana cost contains X.
 */
export function hasXInCost(manaCost: string): boolean {
  return manaCost.includes('{X}');
}

/**
 * Parse modal spell text.
 * "Choose one —" or "Choose two —"
 */
function parseModalSpell(tokens: string[]): ModalSpell | null {
  if (tokens.length < 3) return null;
  if (tokens[0] !== 'choose') return null;

  let chooseCount: number;
  if (tokens[1] === 'one') {
    chooseCount = 1;
  } else if (tokens[1] === 'two') {
    chooseCount = 2;
  } else {
    return null;
  }

  // Find the dash (—)
  let dashIdx = -1;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i] === '—' || tokens[i] === '-' || tokens[i] === '–') {
      dashIdx = i;
      break;
    }
  }
  if (dashIdx === -1) return null;

  // Parse choices (each starts with •)
  const choices: ModalChoice[] = [];
  let currentChoice: { tokens: string[]; label: string } | null = null;

  for (let i = dashIdx + 1; i < tokens.length; i++) {
    if (tokens[i] === '•') {
      // Start new choice
      if (currentChoice && currentChoice.tokens.length > 0) {
        const result = parseEffectClause(currentChoice.tokens, 0);
        if (result) {
          choices.push({
            label: currentChoice.label,
            effects: result.effects,
            targets: result.targets.map(t => ({ id: t.id, type: t.type })),
          });
        }
      }
      currentChoice = { tokens: [], label: `Choice ${choices.length + 1}` };
    } else if (currentChoice) {
      currentChoice.tokens.push(tokens[i]);
    }
  }

  // Handle last choice
  if (currentChoice && currentChoice.tokens.length > 0) {
    const result = parseEffectClause(currentChoice.tokens, 0);
    if (result) {
      choices.push({
        label: currentChoice.label,
        effects: result.effects,
        targets: result.targets.map(t => ({ id: t.id, type: t.type })),
      });
    }
  }

  if (choices.length === 0) return null;

  return {
    kind: 'Modal',
    chooseCount,
    choices,
  };
}

/**
 * Parse oracle text into a ParsedOracle result.
 */
export function parseOracleText(oracleText: string, manaCost?: string): ParsedOracle {
  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  const tokens = tokenizeOracleText(oracleText);
  const xCost = manaCost ? hasXInCost(manaCost) : false;

  if (tokens.length === 0) {
    return { kind: 'Unparsed', reason: 'Empty oracle text' };
  }

  // Check for modal spell ("Choose one —" or "Choose two —")
  if (tokens[0] === 'choose') {
    const modal = parseModalSpell(tokens);
    if (modal) {
      return { kind: 'Modal', modal, xCost };
    }
  }

  // Check for ETB trigger
  const etbIndex = matchETBPrefix(tokens);
  if (etbIndex > 0) {
    const effectResult = parseEffectClause(tokens, etbIndex);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: effectResult.effects,
      };
      return {
        kind: 'ETB',
        ability,
        targets: effectResult.targets,
      };
    }
    return { kind: 'Unparsed', reason: 'Could not parse ETB effect clause' };
  }

  // Check for dies trigger
  const diesIndex = matchDiesPrefix(tokens);
  if (diesIndex > 0) {
    const effectResult = parseEffectClause(tokens, diesIndex);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: { kind: 'Dies', who: 'self' },
        effects: effectResult.effects,
      };
      return {
        kind: 'Dies',
        ability,
        targets: effectResult.targets,
      };
    }
    return { kind: 'Unparsed', reason: 'Could not parse dies effect clause' };
  }

  // Try to parse as a spell effect
  const effectResult = parseEffectClause(tokens, 0);
  if (effectResult) {
    return {
      kind: 'Spell',
      effects: effectResult.effects,
      targets: effectResult.targets,
      xCost,
    };
  }

  return { kind: 'Unparsed', reason: 'No recognized pattern' };
}

/**
 * Convenience: check if oracle text is parseable.
 */
export function canParseOracleText(oracleText: string): boolean {
  const result = parseOracleText(oracleText);
  return result.kind !== 'Unparsed';
}

// ============================================================================
// Activated ability parsing
// ============================================================================

const MANA_SYMBOL_RE = /^\{[^}]+\}(?:\{[^}]+\})*$/;

/**
 * Parse the cost portion of an activated ability (tokens before the colon).
 * Recognizes: {T}, "sacrifice ~", mana symbols like {2}{B}
 */
function parseCostTokens(tokens: string[]): ActivatedAbilityCost | null {
  const cost: ActivatedAbilityCost = {};
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // {t} = tap symbol
    if (tok === '{t}') {
      cost.tap = true;
      i++;
      // skip comma
      if (tokens[i] === ',') i++;
      continue;
    }

    // "sacrifice ~", "sacrifice this", or "sacrifice <card name>"
    if (tok === 'sacrifice') {
      cost.sacrifice = 'self';
      i++; // skip "sacrifice"
      // Consume the sacrifice target (could be "~", "this", or a card name)
      while (i < tokens.length && tokens[i] !== ',' && !tokens[i].startsWith('{')) {
        i++;
      }
      if (tokens[i] === ',') i++;
      continue;
    }

    // Mana symbol(s) like {2}{b}
    if (tok.startsWith('{') && tok.endsWith('}')) {
      cost.mana = tok;
      i++;
      if (tokens[i] === ',') i++;
      continue;
    }

    // Unknown cost token — bail
    return null;
  }

  // Must have at least one cost component
  if (!cost.tap && !cost.sacrifice && !cost.mana) return null;

  return cost;
}

/**
 * Match "search your library for a basic land card, put it onto the battlefield tapped, then shuffle"
 * and variations. Returns SearchLibrary + optional Shuffle effects.
 */
function matchSearchLibrary(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "search your library for a basic land card"
  if (slice.length < 7) return null;
  if (slice[0] !== 'search') return null;
  if (slice[1] !== 'your') return null;
  if (slice[2] !== 'library') return null;
  if (slice[3] !== 'for') return null;
  if (slice[4] !== 'a') return null;

  let idx = 5;

  // Parse optional "basic" supertype
  const supertypes: string[] = [];
  if (slice[idx] === 'basic') {
    supertypes.push('basic');
    idx++;
  }

  // Parse type (e.g., "land")
  const types: string[] = [];
  if (slice[idx] === 'land') {
    types.push('land');
    idx++;
  } else {
    return null;
  }

  // Skip "card"
  if (slice[idx] === 'card') idx++;
  // Skip comma
  if (slice[idx] === ',') idx++;

  // Parse destination: "put it onto the battlefield [tapped]" or "put it into your hand"
  let destination: 'battlefield' | 'hand' | 'graveyard' = 'battlefield';
  let tapped = false;

  if (slice[idx] === 'put' && slice[idx + 1] === 'it') {
    idx += 2;
    if (slice[idx] === 'onto' && slice[idx + 1] === 'the' && slice[idx + 2] === 'battlefield') {
      destination = 'battlefield';
      idx += 3;
      if (slice[idx] === 'tapped') {
        tapped = true;
        idx++;
      }
    } else if (slice[idx] === 'into' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
      destination = 'hand';
      idx += 3;
    }
  }

  // Skip comma
  if (slice[idx] === ',') idx++;

  // Parse shuffle
  let shuffle = false;
  if (slice[idx] === 'then' && slice[idx + 1] === 'shuffle') {
    shuffle = true;
    idx += 2;
  } else if (slice[idx] === 'shuffle') {
    shuffle = true;
    idx++;
  }

  // Skip trailing period
  if (slice[idx] === '.') idx++;

  const filter: CardFilter = {
    types: types.length > 0 ? types : undefined,
    supertypes: supertypes.length > 0 ? supertypes : undefined,
  };

  const effects: Effect[] = [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter,
      destination,
      tapped,
      shuffle,
    },
  ];

  if (shuffle) {
    effects.push({
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    });
  }

  return { effects, targets: [], consumed: idx };
}

/**
 * Check if a set of effects contains any mana-producing effect.
 */
function containsManaEffect(effects: Effect[]): boolean {
  // For now, mana abilities are only detected from overrides or explicit patterns.
  // No AddMana effect type yet, so no parsed abilities are mana abilities.
  return false;
}

/**
 * Parse activated abilities from oracle text.
 * Does NOT modify parseOracleText(). This is a separate function.
 *
 * Splits on newlines, looks for ":" colon separator, parses cost and effect.
 */
export function parseActivatedAbilities(oracleText: string): ActivatedAbility[] {
  if (!oracleText) return [];

  const abilities: ActivatedAbility[] = [];
  const lines = oracleText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip lines that are clearly not activated abilities
    // (triggered abilities start with "when", "whenever", "at")
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('when ') || lower.startsWith('whenever ') || lower.startsWith('at ')) continue;

    // Look for colon separator (but not inside mana symbols like {T})
    // An activated ability has the form: <cost> : <effect>
    const colonIdx = findAbilityColon(trimmed);
    if (colonIdx === -1) continue;

    const costPart = trimmed.slice(0, colonIdx).trim();
    const effectPart = trimmed.slice(colonIdx + 1).trim();

    if (!costPart || !effectPart) continue;

    // Tokenize cost and effect parts
    const costTokens = tokenizeOracleText(costPart);
    const effectTokens = tokenizeOracleText(effectPart);

    // Parse cost
    const cost = parseCostTokens(costTokens);
    if (!cost) continue;

    // Skip mana-only tap abilities like "{T}: Add {G}" — already handled by tapLandForMana
    const effectLower = effectPart.toLowerCase();
    if (effectLower.startsWith('add {') && cost.tap && !cost.sacrifice && !cost.mana) continue;

    // Try to parse effects (SearchLibrary first, then standard patterns)
    let result = matchSearchLibrary(effectTokens, 0);
    if (!result) {
      result = parseEffectClause(effectTokens, 0);
    }

    if (!result) continue;

    const isManaAbility = containsManaEffect(result.effects);

    abilities.push({
      kind: 'ActivatedAbility',
      cost,
      effects: result.effects,
      isManaAbility,
      targets: result.targets.map(t => ({ id: t.id, type: t.type })),
    });
  }

  return abilities;
}

/**
 * Find the colon that separates cost from effect in an activated ability line.
 * Skips colons inside braces like {T}.
 */
function findAbilityColon(text: string): number {
  let inBrace = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') inBrace = true;
    else if (text[i] === '}') inBrace = false;
    else if (text[i] === ':' && !inBrace) return i;
  }
  return -1;
}
