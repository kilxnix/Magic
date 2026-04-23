// Phase 4: Oracle text parser
// Phase 10: Extended with modal, X costs, tokens, and more patterns
// Phase 14: Expanded with ForEach, ExileFromLibrary, GainControl, sacrifice-as-effect, and more
// Phase 16: Blink/flicker, copy effects, keyword granting, phasing
// Phase 17: Planeswalker loyalty abilities and additional trigger types
// Converts tokenized oracle text into Effect AST + required TargetSpecs

import { tokenizeOracleText } from './tokens';
import type { Effect, TriggeredAbility, Trigger, TargetRef, SourceRef, TokenDefinition, AmountRef, ModalSpell, ModalChoice, ActivatedAbility, ActivatedAbilityCost, CardFilter, ForEachAmount, BlinkEffect, CopyEffect, GrantKeywordEffect, PhaseOutEffect, LoyaltyAbility, StaticAbilityEffect, StaticModifier, Condition, ConditionalEffect, WinGameEffect, LoseGameEffect } from './ast';
import type { TargetSpec, TargetType } from './targets';

export type ParsedOracle =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[]; xCost?: boolean }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Modal'; modal: ModalSpell; xCost?: boolean }
  | { kind: 'Dies'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Triggered'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'StaticAbility'; ability: StaticAbilityEffect }
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
 * Match: "destroy target permanent"
 * Match: "destroy target artifact"
 * Match: "destroy target enchantment"
 * Match: "destroy target artifact or enchantment"
 */
function matchDestroy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed = 3;
  let opponentControls = false;

  if (slice[2] === 'creature') {
    targetType = 'Creature';
  } else if (slice[2] === 'permanent') {
    targetType = 'Permanent';
  } else if (slice[2] === 'artifact' && slice[3] === 'or' && slice[4] === 'enchantment') {
    targetType = 'ArtifactOrEnchantment';
    consumed = 5;
  } else if (slice[2] === 'artifact') {
    targetType = 'Artifact';
  } else if (slice[2] === 'enchantment') {
    targetType = 'Enchantment';
  } else {
    return null;
  }

  // Check for "an opponent controls"
  if (slice[consumed] === 'an' && slice[consumed + 1] === 'opponent' && slice[consumed + 2] === 'controls') {
    opponentControls = true;
    consumed += 3;
  }

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec(targetType, opponentControls ? { opponentControls: true } : undefined);
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
 * Match: "exile target nonland permanent"
 */
function matchExile(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed: number;

  if (slice[2] === 'creature') {
    targetType = 'Creature';
    consumed = 3;
  } else if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    consumed = 4;
  } else if (slice[2] === 'permanent') {
    targetType = 'Permanent';
    consumed = 3;
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
 * Match: "return target nonland permanent to its owner's hand"
 */
function matchReturnToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let idx: number;

  if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx = 4;
  } else if (slice[2] === 'creature') {
    targetType = 'Creature';
    idx = 3;
  } else {
    return null;
  }

  if (slice[idx] !== 'to') return null;
  if (slice[idx + 1] !== 'its') return null;
  if (slice[idx + 2] !== "owner's" && slice[idx + 2] !== 'owners') return null;
  if (slice[idx + 3] !== 'hand') return null;

  let consumed = idx + 4;

  // Handle trailing period
  if (tokens[startIndex + consumed] === '.') {
    consumed++;
  }

  const spec = makeTargetSpec(targetType);
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
 * Match: "surveil N"
 * Surveil is a keyword action: look at top N cards, put any number into graveyard,
 * rest on top in any order. Simplified implementation uses AI heuristic.
 */
function matchSurveil(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 2) return null;
  if (slice[0] !== 'surveil') return null;

  const count = parseInt(slice[1], 10);
  if (isNaN(count)) return null;

  let consumed = 2;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Surveil',
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
 * Match: "counter target spell"
 * Match: "counter target noncreature spell"
 */
function matchCounterSpell(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'counter') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let consumed: number;
  let filter: 'noncreature' | undefined;

  if (slice[2] === 'noncreature' && slice[3] === 'spell') {
    targetType = 'NoncreatureSpell';
    filter = 'noncreature';
    consumed = 4;
  } else if (slice[2] === 'spell') {
    targetType = 'Spell';
    consumed = 3;
  } else {
    return null;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'CounterSpell',
    target: makeChosenRef(spec),
    filter,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return target creature card from your graveyard to your hand"
 * Match: "return target creature card from your graveyard to the battlefield"
 */
function matchReturnFromGraveyard(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 9) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'target') return null;
  if (slice[2] !== 'creature') return null;
  if (slice[3] !== 'card') return null;
  if (slice[4] !== 'from') return null;
  if (slice[5] !== 'your') return null;
  if (slice[6] !== 'graveyard') return null;
  if (slice[7] !== 'to') return null;

  let destination: 'hand' | 'battlefield';
  let consumed: number;

  // "to your hand"
  if (slice[8] === 'your' && slice[9] === 'hand') {
    destination = 'hand';
    consumed = 10;
  }
  // "to the battlefield"
  else if (slice[8] === 'the' && slice[9] === 'battlefield') {
    destination = 'battlefield';
    consumed = 10;
  } else {
    return null;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('CreatureCardInGraveyard');
  const effect: Effect = {
    kind: 'ReturnFromGraveyard',
    target: makeChosenRef(spec),
    destination,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "target creature gets +N/+N until end of turn"
 * Match: "target creature gets -N/-N until end of turn"
 * Match: "creatures you control get +N/+N until end of turn"
 */
function matchModifyPT(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "creatures you control get +N/+N until end of turn"
  if (slice.length >= 8 &&
      slice[0] === 'creatures' && slice[1] === 'you' && slice[2] === 'control' &&
      slice[3] === 'get') {
    const ptMatch = slice[4]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    const power = parseInt(ptMatch[1], 10);
    const toughness = parseInt(ptMatch[2], 10);

    if (slice[5] !== 'until' || slice[6] !== 'end' || slice[7] !== 'of' || slice[8] !== 'turn') return null;

    let consumed = 9;
    if (tokens[startIndex + consumed] === '.') consumed++;

    const effect: Effect = {
      kind: 'ModifyPT',
      target: { kind: 'AllCreaturesYouControl' },
      power,
      toughness,
      untilEndOfTurn: true,
    };

    return { effects: [effect], targets: [], consumed };
  }

  // "target creature gets +N/+N until end of turn"
  if (slice.length < 8) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'creature') return null;
  if (slice[2] !== 'gets') return null;

  const ptMatch = slice[3]?.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (!ptMatch) return null;
  const power = parseInt(ptMatch[1], 10);
  const toughness = parseInt(ptMatch[2], 10);

  if (slice[4] !== 'until' || slice[5] !== 'end' || slice[6] !== 'of' || slice[7] !== 'turn') return null;

  let consumed = 8;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'ModifyPT',
    target: makeChosenRef(spec),
    power,
    toughness,
    untilEndOfTurn: true,
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "discard a card"
 * (controller discards, used in multi-effect parsing like "draw a card, then discard a card")
 */
function matchDiscardSelf(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'discard') return null;

  let count: number;
  let consumed: number;

  if (slice[1] === 'a' && slice[2] === 'card') {
    count = 1;
    consumed = 3;
  } else {
    const n = parseInt(slice[1], 10);
    if (isNaN(n)) return null;
    if (slice[2] !== 'cards' && slice[2] !== 'card') return null;
    count = n;
    consumed = 3;
  }

  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Discard',
    player: { kind: 'Controller' },
    count,
  };

  return { effects: [effect], targets: [], consumed };
}

// ============================================================================
// Phase 14: New pattern matchers
// ============================================================================

/**
 * Parse a word number like "one", "two", "three", etc. Returns the number or NaN.
 */
function parseWordNumber(word: string): number {
  const map: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  return map[word] ?? NaN;
}

/**
 * Match: "draw a card for each creature you control"
 * Match: "add {R} for each card in target opponent's hand" (simplified: gain life = N)
 * Match: "create a 1/1 ... token for each creature that died this turn"
 *
 * This detects "for each" trailing an effect and wraps the amount in ForEachAmount.
 */
function matchForEachDraw(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  // "draw a card for each [type] you control"
  // "draw a card for each [type] [player] controls"
  if (slice.length < 7) return null;
  if (slice[0] !== 'draw') return null;
  if (slice[1] !== 'a' || slice[2] !== 'card') return null;
  if (slice[3] !== 'for') return null;
  if (slice[4] !== 'each') return null;

  // Parse the counted thing: "creature you control", "card in your hand", etc.
  let idx = 5;
  const filter: CardFilter = {};

  // Parse type: creature, artifact, enchantment, permanent, card, etc.
  const typeWord = slice[idx];
  if (typeWord === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (typeWord === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (typeWord === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (typeWord === 'permanent') {
    filter.types = ['permanent'];
    idx++;
  } else if (typeWord === 'card') {
    idx++;
  } else if (typeWord === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  // Determine the zone and controller
  let zone: ForEachAmount['zone'] = 'battlefield';
  let controller: ForEachAmount['controller'] = 'you';

  // "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    controller = 'you';
    zone = 'battlefield';
    idx += 2;
  }
  // "in your hand"
  else if (slice[idx] === 'in' && slice[idx + 1] === 'your' && slice[idx + 2] === 'hand') {
    zone = 'hand';
    controller = 'you';
    idx += 3;
  }
  // "in your graveyard"
  else if (slice[idx] === 'in' && slice[idx + 1] === 'your' && slice[idx + 2] === 'graveyard') {
    zone = 'graveyard';
    controller = 'you';
    idx += 3;
  }
  // "an opponent controls"
  else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    controller = 'opponent';
    zone = 'battlefield';
    idx += 3;
  }
  // "in target opponent's hand" — simplified, treat as opponent
  else if (slice[idx] === 'in' && slice[idx + 1] === 'target' && slice[idx + 2] === "opponent's" && slice[idx + 3] === 'hand') {
    zone = 'hand';
    controller = 'opponent';
    idx += 4;
  }
  else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone,
    filter: filter.types ? filter : undefined,
    controller,
  };

  const effect: Effect = {
    kind: 'Draw',
    player: { kind: 'Controller' },
    count: forEachAmount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "create a 1/1 ... token for each creature you control"
 * General pattern: any create token followed by "for each"
 */
function matchCreateTokenForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 8) return null;
  if (slice[0] !== 'create') return null;

  // Find "for each" in the token stream
  let forEachIdx = -1;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] === 'for' && slice[i + 1] === 'each') {
      forEachIdx = i;
      break;
    }
  }
  if (forEachIdx === -1) return null;

  // Parse the token definition part (everything between "create" and "for each")
  // We'll use matchCreateToken on a sub-slice that ends with a period
  const tokenSubSlice = [...slice.slice(0, forEachIdx), '.'];
  const tokenResult = matchCreateToken(tokenSubSlice, 0);
  if (!tokenResult) return null;

  // Now parse the "for each" part
  let idx = forEachIdx + 2; // skip "for each"
  const filter: CardFilter = {};

  const typeWord = slice[idx];
  if (typeWord === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (typeWord === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (typeWord === 'opponent') {
    // "for each opponent" — count opponents
    idx++;
    if (slice[idx] === '.') idx++;
    const createEffect = tokenResult.effects[0];
    if (createEffect.kind !== 'CreateToken') return null;
    const forEachAmount: ForEachAmount = {
      kind: 'ForEach',
      zone: 'battlefield',
      controller: 'opponent',
    };
    const effect: Effect = {
      ...createEffect,
      count: forEachAmount,
    };
    return { effects: [effect], targets: [], consumed: idx };
  } else {
    return null;
  }

  let zone: ForEachAmount['zone'] = 'battlefield';
  let controller: ForEachAmount['controller'] = 'you';

  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  } else if (slice[idx] === 'that' && slice[idx + 1] === 'died' && slice[idx + 2] === 'this' && slice[idx + 3] === 'turn') {
    zone = 'graveyard';
    idx += 4;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone,
    filter: filter.types ? filter : undefined,
    controller,
  };

  const createEffect = tokenResult.effects[0];
  if (createEffect.kind !== 'CreateToken') return null;
  const effect: Effect = {
    ...createEffect,
    count: forEachAmount,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "exile the top N cards of your library"
 * Match: "exile the top card of your library"
 * Optionally followed by ". you may play them this turn" / ". you may play them until end of turn"
 */
function matchExileFromLibraryTop(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'the') return null;
  if (slice[2] !== 'top') return null;

  let count: number;
  let idx: number;

  // "the top card" (singular)
  if (slice[3] === 'card') {
    count = 1;
    idx = 4;
  }
  // "the top N cards" or "the top three cards"
  else {
    count = parseInt(slice[3], 10);
    if (isNaN(count)) {
      count = parseWordNumber(slice[3]);
    }
    if (isNaN(count)) return null;
    if (slice[4] !== 'cards' && slice[4] !== 'card') return null;
    idx = 5;
  }

  if (slice[idx] !== 'of') return null;
  if (slice[idx + 1] !== 'your') return null;
  if (slice[idx + 2] !== 'library') return null;
  idx += 3;

  if (slice[idx] === '.') idx++;

  // Check for "you may play them/it this turn" / "until end of turn"
  let mayPlay = false;
  if (slice[idx] === 'you' && slice[idx + 1] === 'may' && slice[idx + 2] === 'play') {
    mayPlay = true;
    idx += 3;
    // skip "them" or "it"
    if (slice[idx] === 'them' || slice[idx] === 'it') idx++;
    // skip "this turn" or "until end of turn"
    if (slice[idx] === 'this' && slice[idx + 1] === 'turn') {
      idx += 2;
    } else if (slice[idx] === 'until' && slice[idx + 1] === 'end' && slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
      idx += 4;
    }
    if (slice[idx] === '.') idx++;
  }

  const effect: Effect = {
    kind: 'ExileFromLibrary',
    player: { kind: 'Controller' },
    count,
    mayPlay,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "search your library for a card" (generic tutor — any card type)
 * Match: "search your library for a card, put it into your hand, then shuffle"
 * Match: "search your library for a card and put that card on top"
 * Simplified: treated as Draw 1 (since we can't prompt for specific card choice)
 */
function matchSearchLibraryGeneric(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'search') return null;
  if (slice[1] !== 'your') return null;
  if (slice[2] !== 'library') return null;
  if (slice[3] !== 'for') return null;
  if (slice[4] !== 'a') return null;
  if (slice[5] !== 'card') return null;

  let idx = 6;

  // Skip optional destination clauses and shuffle
  // "put it into your hand" / "put that card on top" etc.
  // We consume everything until end of tokens or next sentence
  let shuffle = false;
  let destination: 'hand' | 'battlefield' | 'graveyard' = 'hand';

  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'put') {
    // Skip "put it into your hand" or "put that card on top"
    while (idx < slice.length && slice[idx] !== ',' && slice[idx] !== '.' && slice[idx] !== 'then') {
      if (slice[idx] === 'top') {
        destination = 'hand'; // treat "on top" as effectively draw-like
      }
      idx++;
    }
  }
  if (slice[idx] === ',') idx++;
  if (slice[idx] === 'then' && slice[idx + 1] === 'shuffle') {
    shuffle = true;
    idx += 2;
  } else if (slice[idx] === 'shuffle') {
    shuffle = true;
    idx++;
  }
  // "then shuffle your library"
  if (slice[idx] === 'your' && slice[idx + 1] === 'library') {
    idx += 2;
  }
  if (slice[idx] === '.') idx++;

  // Simplify: generic tutor = Draw 1 (card goes to hand)
  const effects: Effect[] = [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
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
 * Match: "sacrifice a creature" / "sacrifice an artifact" (as effect, not cost)
 * Match: "sacrifice a permanent"
 */
function matchSacrificeAsEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'sacrifice') return null;
  if (slice[1] !== 'a' && slice[1] !== 'an') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'permanent') {
    // no type filter needed — matches anything on battlefield
    idx++;
  } else if (slice[idx] === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Sacrifice',
    player: { kind: 'Controller' },
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "each player draws a card" / "each player draws N cards"
 * Match: "each player sacrifices a creature"
 * Match: "each player discards a card"
 * Match: "each player loses N life"
 */
function matchEachPlayerEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'player') return null;

  let idx = 2;

  // "each player draws a card" / "each player draws N cards"
  if (slice[idx] === 'draws') {
    idx++;
    let count: number;
    if (slice[idx] === 'a' && slice[idx + 1] === 'card') {
      count = 1;
      idx += 2;
    } else {
      count = parseInt(slice[idx], 10);
      if (isNaN(count)) return null;
      idx++;
      if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
    }
    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'Draw',
      player: { kind: 'EachPlayer' },
      count,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // "each player sacrifices a creature"
  if (slice[idx] === 'sacrifices') {
    idx++;
    if (slice[idx] !== 'a' && slice[idx] !== 'an') return null;
    idx++;

    const filter: CardFilter = {};
    if (slice[idx] === 'creature') {
      filter.types = ['creature'];
      idx++;
    } else if (slice[idx] === 'artifact') {
      filter.types = ['artifact'];
      idx++;
    } else if (slice[idx] === 'enchantment') {
      filter.types = ['enchantment'];
      idx++;
    } else if (slice[idx] === 'permanent') {
      idx++;
    } else if (slice[idx] === 'land') {
      filter.types = ['land'];
      idx++;
    } else {
      return null;
    }

    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'Sacrifice',
      player: { kind: 'EachPlayer' },
      filter: filter.types ? filter : undefined,
      count: 1,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // "each player discards a card" / "each player discards N cards"
  if (slice[idx] === 'discards') {
    idx++;
    let count: number;
    if (slice[idx] === 'a' && slice[idx + 1] === 'card') {
      count = 1;
      idx += 2;
    } else {
      count = parseInt(slice[idx], 10);
      if (isNaN(count)) return null;
      idx++;
      if (slice[idx] === 'cards' || slice[idx] === 'card') idx++;
    }
    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'Discard',
      player: { kind: 'EachPlayer' },
      count,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  // "each player loses N life"
  if (slice[idx] === 'loses') {
    idx++;
    const amount = parseInt(slice[idx], 10);
    if (isNaN(amount)) return null;
    idx++;
    if (slice[idx] !== 'life') return null;
    idx++;
    if (slice[idx] === '.') idx++;

    const effect: Effect = {
      kind: 'LoseLife',
      player: { kind: 'EachPlayer' },
      amount,
    };
    return { effects: [effect], targets: [], consumed: idx };
  }

  return null;
}

/**
 * Match: "each opponent sacrifices a creature"
 * Match: "each opponent sacrifices an artifact"
 */
function matchEachOpponentSacrifice(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'sacrifices') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;

  let idx = 4;
  const filter: CardFilter = {};

  if (slice[idx] === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'permanent') {
    idx++;
  } else if (slice[idx] === 'land') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Sacrifice',
    player: { kind: 'EachOpponent' },
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "target player sacrifices a creature"
 * Match: "target player sacrifices an artifact"
 */
function matchTargetPlayerSacrifice(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'player') return null;
  if (slice[2] !== 'sacrifices') return null;
  if (slice[3] !== 'a' && slice[3] !== 'an') return null;

  let idx = 4;
  const filter: CardFilter = {};

  if (slice[idx] === 'creature') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifact') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantment') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'permanent') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Player');
  const effect: Effect = {
    kind: 'Sacrifice',
    player: makeChosenRef(spec),
    filter: filter.types ? filter : undefined,
    count: 1,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "gain control of target creature"
 * Match: "gain control of target permanent"
 * Match: "gain control of target artifact"
 */
function matchGainControl(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'gain') return null;
  if (slice[1] !== 'control') return null;
  if (slice[2] !== 'of') return null;
  if (slice[3] !== 'target') return null;

  let targetType: TargetType;
  let consumed = 5;

  if (slice[4] === 'creature') {
    targetType = 'Creature';
  } else if (slice[4] === 'permanent') {
    targetType = 'Permanent';
  } else if (slice[4] === 'artifact') {
    targetType = 'Artifact';
  } else if (slice[4] === 'enchantment') {
    targetType = 'Enchantment';
  } else {
    return null;
  }

  if (slice[consumed] === '.') consumed++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'GainControl',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed };
}

/**
 * Match: "return all creatures to their owners' hands"
 * Match: "return all [type] to their owners' hands"
 */
function matchReturnAllToHand(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 6) return null;
  if (slice[0] !== 'return') return null;
  if (slice[1] !== 'all') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanents') {
    // "return all nonland permanents" — no simple type filter, treat as permanent
    idx += 2;
  } else if (slice[idx] === 'permanents') {
    idx++;
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantments') {
    filter.types = ['enchantment'];
    idx++;
  } else {
    return null;
  }

  // "to their owners' hands" / "to their owner's hand"
  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'their') return null;
  idx++;
  if (slice[idx] !== "owners'" && slice[idx] !== "owner's") return null;
  idx++;
  if (slice[idx] !== 'hands' && slice[idx] !== 'hand') return null;
  idx++;

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'ReturnToHand',
    target: { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "exile all artifacts" / "exile all enchantments" / "exile all creatures"
 */
function matchExileAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'all') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantments') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanents') {
    idx += 2;
  } else if (slice[idx] === 'permanents') {
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Exile',
    target: { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "destroy all artifacts" / "destroy all enchantments"
 * (extends existing destroyAll which only handles creatures)
 */
function matchDestroyAllExpanded(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'all') return null;

  let idx = 2;
  const filter: CardFilter = {};

  if (slice[idx] === 'creatures') {
    // Already handled by matchDestroyAll — use AllCreatures target
    return null; // let existing handler do it
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'enchantments') {
    filter.types = ['enchantment'];
    idx++;
  } else if (slice[idx] === 'nonland' && slice[idx + 1] === 'permanents') {
    idx += 2;
  } else if (slice[idx] === 'permanents') {
    idx++;
  } else if (slice[idx] === 'artifacts' && slice[idx + 1] === 'and' && slice[idx + 2] === 'enchantments') {
    filter.types = ['artifact', 'enchantment'];
    idx += 3;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllOfType', filter },
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "~ deals damage equal to the number of creatures you control to any target"
 * Match: "~ deals damage to target creature equal to the number of creatures you control"
 * Simplified: recognizes "damage equal to the number of [type] you control"
 */
function matchDealDamageForEach(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 10) return null;
  if (slice[0] !== '~') return null;
  if (slice[1] !== 'deals') return null;
  if (slice[2] !== 'damage') return null;
  if (slice[3] !== 'equal') return null;
  if (slice[4] !== 'to') return null;
  if (slice[5] !== 'the') return null;
  if (slice[6] !== 'number') return null;
  if (slice[7] !== 'of') return null;

  let idx = 8;
  const filter: CardFilter = {};

  if (slice[idx] === 'creatures') {
    filter.types = ['creature'];
    idx++;
  } else if (slice[idx] === 'artifacts') {
    filter.types = ['artifact'];
    idx++;
  } else if (slice[idx] === 'lands') {
    filter.types = ['land'];
    idx++;
  } else {
    return null;
  }

  let controller: ForEachAmount['controller'] = 'you';
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  } else {
    return null;
  }

  // Now find the target: "to any target", "to target creature", "to target player"
  if (slice[idx] !== 'to') return null;
  idx++;

  let targetType: TargetType;
  if (slice[idx] === 'any' && slice[idx + 1] === 'target') {
    targetType = 'Any';
    idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'creature') {
    targetType = 'Creature';
    idx += 2;
  } else if (slice[idx] === 'target' && slice[idx + 1] === 'player') {
    targetType = 'Player';
    idx += 2;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const forEachAmount: ForEachAmount = {
    kind: 'ForEach',
    zone: 'battlefield',
    filter,
    controller,
  };

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'DealDamage',
    source: { kind: 'ThisSpell' } as SourceRef,
    target: makeChosenRef(spec),
    amount: forEachAmount,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

// ============================================================================
// Phase 16: Blink/flicker, copy, keyword granting, phasing patterns
// ============================================================================

/**
 * Known keywords for "target creature gains [keyword] until end of turn"
 */
const GRANTABLE_KEYWORDS: Record<string, string> = {
  'hexproof': 'Hexproof',
  'indestructible': 'Indestructible',
  'flying': 'Flying',
  'trample': 'Trample',
  'lifelink': 'Lifelink',
  'deathtouch': 'Deathtouch',
  'vigilance': 'Vigilance',
  'reach': 'Reach',
  'menace': 'Menace',
  'haste': 'Haste',
  'defender': 'Defender',
  'shroud': 'Shroud',
  'flash': 'Flash',
  'double strike': 'Double Strike',
  'first strike': 'First Strike',
};

/**
 * Match: "exile target creature, then return it to the battlefield under its owner's control"
 * Match: "exile target creature you control, then return it to the battlefield"
 * Match: "exile target permanent, return it to the battlefield at the beginning of the next end step"
 * Match: "exile target creature. return it to the battlefield under its owner's control"
 */
function matchBlink(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'exile') return null;
  if (slice[1] !== 'target') return null;

  let targetType: TargetType;
  let idx: number;

  if (slice[2] === 'creature') {
    targetType = 'Creature';
    idx = 3;
  } else if (slice[2] === 'permanent') {
    targetType = 'Permanent';
    idx = 3;
  } else if (slice[2] === 'nonland' && slice[3] === 'permanent') {
    targetType = 'NonlandPermanent';
    idx = 4;
  } else {
    return null;
  }

  // Optional "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  }

  // Expect separator: "," or "." or ", then"
  if (slice[idx] === ',') idx++;
  if (slice[idx] === '.') idx++;
  if (slice[idx] === 'then') idx++;

  // Now look for "return it to the battlefield" or "return that card/creature to the battlefield"
  if (slice[idx] !== 'return') return null;
  idx++;

  // Skip "it" / "that card" / "that creature"
  if (slice[idx] === 'it') {
    idx++;
  } else if (slice[idx] === 'that') {
    idx++;
    if (slice[idx] === 'card' || slice[idx] === 'creature' || slice[idx] === 'permanent') idx++;
  }

  if (slice[idx] !== 'to') return null;
  idx++;
  if (slice[idx] !== 'the') return null;
  idx++;
  if (slice[idx] !== 'battlefield') return null;
  idx++;

  let delayed = false;
  let ownerControl = false;

  // Check for "under its owner's control"
  if (slice[idx] === 'under' && slice[idx + 1] === 'its' &&
      (slice[idx + 2] === "owner's" || slice[idx + 2] === 'owners') &&
      slice[idx + 3] === 'control') {
    ownerControl = true;
    idx += 4;
  }

  // Check for "at the beginning of the next end step"
  if (slice[idx] === 'at' && slice[idx + 1] === 'the' && slice[idx + 2] === 'beginning') {
    delayed = true;
    // Skip "at the beginning of the next end step"
    while (idx < slice.length && slice[idx] !== '.' && slice[idx] !== ',') {
      idx++;
    }
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'Blink',
    target: makeChosenRef(spec),
    delayed: delayed || undefined,
    ownerControl: ownerControl || undefined,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "create a token that's a copy of target creature"
 * Match: "create a copy of target creature"
 * Match: "create a token that is a copy of target creature"
 */
function matchCopyCreature(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'create') return null;
  if (slice[1] !== 'a') return null;

  let idx = 2;

  // "create a token that's a copy of ..."
  if (slice[idx] === 'token') {
    idx++;
    // "that's" or "that is"
    if (slice[idx] === "that's") {
      idx++;
    } else if (slice[idx] === 'that' && slice[idx + 1] === 'is') {
      idx += 2;
    } else {
      return null;
    }
    if (slice[idx] !== 'a') return null;
    idx++;
    if (slice[idx] !== 'copy') return null;
    idx++;
    if (slice[idx] !== 'of') return null;
    idx++;
  }
  // "create a copy of ..."
  else if (slice[idx] === 'copy') {
    idx++;
    if (slice[idx] !== 'of') return null;
    idx++;
  } else {
    return null;
  }

  // Now parse target type
  if (slice[idx] !== 'target') return null;
  idx++;

  let targetType: TargetType;
  if (slice[idx] === 'creature') {
    targetType = 'Creature';
    idx++;
  } else if (slice[idx] === 'permanent') {
    targetType = 'Permanent';
    idx++;
  } else {
    return null;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType);
  const effect: Effect = {
    kind: 'Copy',
    target: makeChosenRef(spec),
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "target creature gains [keyword] until end of turn"
 * Match: "target creature you control gains [keyword] until end of turn"
 * Match: "target creature gains [keyword]"
 * Match: "target creature you control gains [keyword]"
 * Match: "target creature gains double strike until end of turn" (two-word keyword)
 * Match: "target creature gains first strike until end of turn" (two-word keyword)
 */
function matchGrantKeyword(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;
  if (slice[0] !== 'target') return null;
  if (slice[1] !== 'creature') return null;

  let idx = 2;

  // Optional "you control"
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    idx += 2;
  }

  if (slice[idx] !== 'gains') return null;
  idx++;

  // Try two-word keywords first: "double strike", "first strike"
  let keyword: string | null = null;
  const twoWordKey = slice[idx] + ' ' + slice[idx + 1];
  if (GRANTABLE_KEYWORDS[twoWordKey]) {
    keyword = GRANTABLE_KEYWORDS[twoWordKey];
    idx += 2;
  } else if (GRANTABLE_KEYWORDS[slice[idx]]) {
    keyword = GRANTABLE_KEYWORDS[slice[idx]];
    idx++;
  }

  if (!keyword) return null;

  // Check for "until end of turn"
  let untilEndOfTurn = false;
  if (slice[idx] === 'until' && slice[idx + 1] === 'end' &&
      slice[idx + 2] === 'of' && slice[idx + 3] === 'turn') {
    untilEndOfTurn = true;
    idx += 4;
  }

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec('Creature');
  const effect: Effect = {
    kind: 'GrantKeyword',
    target: makeChosenRef(spec),
    keyword,
    untilEndOfTurn,
  };

  return { effects: [effect], targets: [spec], consumed: idx };
}

/**
 * Match: "target permanent phases out"
 * Match: "target creature phases out"
 */
function matchPhaseOut(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 4) return null;

  // "target permanent/creature phases out"
  if (slice[0] === 'target') {
    let targetType: TargetType;
    let idx: number;

    if (slice[1] === 'permanent') {
      targetType = 'Permanent';
      idx = 2;
    } else if (slice[1] === 'creature') {
      targetType = 'Creature';
      idx = 2;
    } else if (slice[1] === 'nonland' && slice[2] === 'permanent') {
      targetType = 'NonlandPermanent';
      idx = 3;
    } else {
      return null;
    }

    if (slice[idx] !== 'phases') return null;
    idx++;
    if (slice[idx] !== 'out') return null;
    idx++;

    if (slice[idx] === '.') idx++;

    const spec = makeTargetSpec(targetType);
    const effect: Effect = {
      kind: 'PhaseOut',
      target: makeChosenRef(spec),
    };

    return { effects: [effect], targets: [spec], consumed: idx };
  }

  return null;
}

/**
 * Match: "you win the game"
 */
function matchWinGame(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] === 'you' && slice[1] === 'win' && slice[2] === 'the' && slice[3] === 'game') {
    let consumed = 4;
    if (slice[consumed] === '.') consumed++;
    const effect: WinGameEffect = { kind: 'WinGame', player: { kind: 'Controller' } };
    return { effects: [effect], targets: [], consumed };
  }
  return null;
}

/**
 * Match: "you lose the game"
 * Match: "target player loses the game"
 */
function matchLoseGame(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 4) return null;
  if (slice[0] === 'you' && slice[1] === 'lose' && slice[2] === 'the' && slice[3] === 'game') {
    let consumed = 4;
    if (slice[consumed] === '.') consumed++;
    const effect: LoseGameEffect = { kind: 'LoseGame', player: { kind: 'Controller' } };
    return { effects: [effect], targets: [], consumed };
  }
  if (slice[0] === 'target' && slice[1] === 'player' && slice[2] === 'loses' && slice[3] === 'the' && slice[4] === 'game') {
    let consumed = 5;
    if (slice[consumed] === '.') consumed++;
    const spec = makeTargetSpec('Player');
    const effect: LoseGameEffect = { kind: 'LoseGame', player: { kind: 'Chosen', targetId: spec.id } };
    return { effects: [effect], targets: [spec], consumed };
  }
  return null;
}

// ============================================================================
// Phase 15: Static ability and conditional effect pattern matchers
// ============================================================================

function parseStaticFilterType(word: string): CardFilter | null {
  // Map of plural → singular for creature subtypes
  const subtypeMap: Record<string, string> = {
    'elf': 'elf', 'elves': 'elf',
    'goblin': 'goblin', 'goblins': 'goblin',
    'zombie': 'zombie', 'zombies': 'zombie',
    'dragon': 'dragon', 'dragons': 'dragon',
    'angel': 'angel', 'angels': 'angel',
    'demon': 'demon', 'demons': 'demon',
    'merfolk': 'merfolk',
    'soldier': 'soldier', 'soldiers': 'soldier',
    'wizard': 'wizard', 'wizards': 'wizard',
    'knight': 'knight', 'knights': 'knight',
    'warrior': 'warrior', 'warriors': 'warrior',
    'cleric': 'cleric', 'clerics': 'cleric',
    'rogue': 'rogue', 'rogues': 'rogue',
    'shaman': 'shaman', 'shamans': 'shaman',
    'beast': 'beast', 'beasts': 'beast',
    'elemental': 'elemental', 'elementals': 'elemental',
    'vampire': 'vampire', 'vampires': 'vampire',
    'sliver': 'sliver', 'slivers': 'sliver',
    'human': 'human', 'humans': 'human',
    'spirit': 'spirit', 'spirits': 'spirit',
    'bird': 'bird', 'birds': 'bird',
    'cat': 'cat', 'cats': 'cat',
    'dinosaur': 'dinosaur', 'dinosaurs': 'dinosaur',
    'pirate': 'pirate', 'pirates': 'pirate',
    'dwarf': 'dwarf', 'dwarves': 'dwarf',
    'wolf': 'wolf', 'wolves': 'wolf',
  };
  const creatureSubtypes = Object.keys(subtypeMap);
  const singular = subtypeMap[word] || word.replace(/s$/, '');
  if (word === 'creatures' || word === 'creature') return { types: ['creature'] };
  if (word === 'artifacts' || word === 'artifact') return { types: ['artifact'] };
  if (word === 'enchantments' || word === 'enchantment') return { types: ['enchantment'] };
  if (word === 'lands' || word === 'land') return { types: ['land'] };
  if (word === 'permanents' || word === 'permanent') return {};
  if (word === 'spells' || word === 'spell') return {};
  if (creatureSubtypes.includes(word)) return { types: ['creature'], subtypes: [singular] };
  return null;
}

function matchStaticAbility(tokens: string[]): StaticAbilityEffect | null {
  let idx = 0;
  let excludeSelf = false;
  if (tokens[idx] === 'other') { excludeSelf = true; idx++; }
  const typeWord = tokens[idx];
  if (!typeWord) return null;
  const filter = parseStaticFilterType(typeWord);
  if (!filter) return null;
  idx++;

  let controller: 'you' | 'opponent' | 'any' = 'you';
  if (tokens[idx] === 'you' && tokens[idx + 1] === 'control') { controller = 'you'; idx += 2; }
  else if (tokens[idx] === 'an' && tokens[idx + 1] === 'opponent' && tokens[idx + 2] === 'controls') { controller = 'opponent'; idx += 3; }
  else if (tokens[idx] === 'you' && tokens[idx + 1] === 'cast') { controller = 'you'; idx += 2; }
  else return null;

  if (tokens[idx] === 'get' || tokens[idx] === 'gets') {
    idx++;
    const ptMatch = tokens[idx]?.match(/^([+-]\d+)\/([+-]\d+)$/);
    if (!ptMatch) return null;
    idx++;
    // "until end of turn" means this is a temporary effect, NOT a static ability
    if (tokens[idx] === 'until') return null;
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'ModifyPT', power: parseInt(ptMatch[1], 10), toughness: parseInt(ptMatch[2], 10) }, filter, controller, excludeSelf };
  }
  if (tokens[idx] === 'have' || tokens[idx] === 'has') {
    idx++;
    const keyword = tokens[idx];
    if (!keyword) return null;
    idx++;
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'GrantKeyword', keyword }, filter, controller, excludeSelf };
  }
  if (tokens[idx] === 'cost') {
    idx++;
    const costMatch = tokens[idx]?.match(/^\{(\d+)\}$/);
    if (!costMatch) return null;
    idx++;
    if (tokens[idx] !== 'less') return null;
    idx++;
    if (tokens[idx] === 'to' && tokens[idx + 1] === 'cast') idx += 2;
    if (tokens[idx] === '.') idx++;
    return { kind: 'StaticAbility', modifier: { kind: 'ReduceCost', amount: parseInt(costMatch[1], 10) }, filter, controller, excludeSelf };
  }
  return null;
}

function matchConditionalEffect(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice.length < 6) return null;

  if (slice[0] === 'if' && slice[1] === 'you' && slice[2] === 'control' && slice[3] === 'a') {
    let idx = 4;
    const typeWord = slice[idx];
    if (!typeWord) return null;
    let filter = parseStaticFilterType(typeWord);
    if (!filter) { filter = { types: ['creature'], subtypes: [typeWord.replace(/s$/, '')] }; }
    idx++;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = { kind: 'Conditional', condition: { kind: 'ControlsType', controller: 'you', filter }, effect: effectResult.effects[0] };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  if (slice[0] === 'if' && slice[1] === 'an' && slice[2] === 'opponent' && slice[3] === 'controls' && slice[4] === 'more') {
    let idx = 5;
    const typeWord = slice[idx];
    if (!typeWord) return null;
    const filter = parseStaticFilterType(typeWord);
    if (!filter) return null;
    idx++;
    if (slice[idx] !== 'than' || slice[idx + 1] !== 'you') return null;
    idx += 2;
    if (slice[idx] === ',') idx++;
    const effectResult = parseEffectClauseInternal(tokens, startIndex + idx);
    if (!effectResult) return null;
    const condEffect: ConditionalEffect = { kind: 'Conditional', condition: { kind: 'ControlsMoreThan', who: 'opponent', what: filter, thanWho: 'you' }, effect: effectResult.effects[0] };
    return { effects: [condEffect], targets: effectResult.targets, consumed: idx + effectResult.consumed };
  }

  return null;
}

function parseEffectClauseInternal(tokens: string[], startIndex: number): PatternResult {
  const patterns = [
    matchWinGame, matchLoseGame,
    matchBlink, matchCopyCreature, matchGrantKeyword, matchPhaseOut,
    matchDealDamageForEach, matchForEachDraw, matchCreateTokenForEach,
    matchExileFromLibraryTop, matchSearchLibraryGeneric, matchEachOpponentSacrifice,
    matchEachPlayerEffect, matchTargetPlayerSacrifice, matchSacrificeAsEffect,
    matchGainControl, matchReturnAllToHand, matchExileAll, matchDestroyAllExpanded,
    matchDealXDamage, matchDrawX, matchEachOpponentLosesLife,
    matchEachOpponentDiscardsCard, matchDestroyAll, matchDealDamage, matchDestroy,
    matchDraw, matchGainLife, matchLoseLife, matchExile, matchReturnFromGraveyard,
    matchReturnToHand, matchMill, matchAddCounters, matchModifyPT, matchTap,
    matchUntap, matchCreateToken, matchDiscard, matchDiscardSelf, matchScry,
    matchSurveil, matchCounterSpell,
  ];
  for (const pattern of patterns) {
    const result = pattern(tokens, startIndex);
    if (result) return result;
  }
  return null;
}

/**
 * Try to parse an effect clause starting at the given index.
 * Returns the first matching pattern.
 */
function parseEffectClause(tokens: string[], startIndex: number): PatternResult {
  // Try patterns in priority order (specific/complex before general, X patterns first)
  const patterns = [
    // Win/lose game effects (simple patterns, high priority)
    matchWinGame,                 // "you win the game"
    matchLoseGame,                // "you lose the game" / "target player loses the game"

    // Phase 15: Conditional effects (before other patterns)
    matchConditionalEffect,       // "if you control a [type], [effect]"

    // Phase 16: Blink, copy, keyword granting, phasing (must come before simpler exile/target patterns)
    matchBlink,                   // "exile target creature, then return it to the battlefield..."
    matchCopyCreature,            // "create a token that's a copy of target creature"
    matchGrantKeyword,            // "target creature gains hexproof until end of turn"
    matchPhaseOut,                // "target permanent phases out"

    // Phase 14: New complex patterns (must come before simpler versions)
    matchDealDamageForEach,       // "~ deals damage equal to the number of..."
    matchForEachDraw,             // "draw a card for each creature you control"
    matchCreateTokenForEach,      // "create a 1/1 ... token for each ..."
    matchExileFromLibraryTop,     // "exile the top N cards of your library"
    matchSearchLibraryGeneric,    // "search your library for a card" (generic tutor)
    matchEachOpponentSacrifice,   // "each opponent sacrifices a creature"
    matchEachPlayerEffect,        // "each player draws/sacrifices/discards"
    matchTargetPlayerSacrifice,   // "target player sacrifices a creature"
    matchSacrificeAsEffect,       // "sacrifice a creature" (as effect)
    matchGainControl,             // "gain control of target creature"
    matchReturnAllToHand,         // "return all creatures to their owners' hands"
    matchExileAll,                // "exile all artifacts"
    matchDestroyAllExpanded,      // "destroy all artifacts/enchantments"

    // Phase 10: X patterns
    matchDealXDamage,
    matchDrawX,

    // Phase 10: Each opponent patterns
    matchEachOpponentLosesLife,
    matchEachOpponentDiscardsCard,
    matchDestroyAll,

    // Core patterns
    matchDealDamage,
    matchDestroy,
    matchDraw,
    matchGainLife,
    matchLoseLife,
    matchExile,
    matchReturnFromGraveyard, // before ReturnToHand — "return target creature card from..."
    matchReturnToHand,
    matchMill,
    matchAddCounters,
    matchModifyPT,
    matchTap,
    matchUntap,
    matchCreateToken,
    matchDiscard,
    matchDiscardSelf,
    matchScry,
    matchSurveil,
    matchCounterSpell,
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
 * Check if tokens start with "Whenever ~ attacks ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchAttacksPrefix(tokens: string[]): number {
  if (tokens.length < 4) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  if (tokens[1] !== '~') return -1;
  if (tokens[2] !== 'attacks') return -1;

  let idx = 3;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of your upkeep ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchUpkeepPrefix(tokens: string[]): number {
  // "at the beginning of your upkeep ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'your') return -1;
  if (tokens[5] !== 'upkeep') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of your end step ," trigger prefix.
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchEndStepPrefix(tokens: string[]): number {
  // "at the beginning of your end step ,"
  if (tokens.length < 8) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'your') return -1;
  if (tokens[5] !== 'end') return -1;
  if (tokens[6] !== 'step') return -1;

  let idx = 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever another creature enters the battlefield under your control ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchAnotherCreatureETBPrefix(tokens: string[]): number {
  // "whenever another creature enters the battlefield under your control ,"
  if (tokens.length < 10) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'another') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'enters') return -1;
  if (tokens[4] !== 'the') return -1;
  if (tokens[5] !== 'battlefield') return -1;
  if (tokens[6] !== 'under') return -1;
  if (tokens[7] !== 'your') return -1;
  if (tokens[8] !== 'control') return -1;

  let idx = 9;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever a creature you control dies ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchCreatureYouControlDiesPrefix(tokens: string[]): number {
  // "whenever a creature you control dies ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'you') return -1;
  if (tokens[4] !== 'control') return -1;
  if (tokens[5] !== 'dies') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you cast a spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchYouCastSpellPrefix(tokens: string[]): number {
  // "whenever you cast a spell ,"
  if (tokens.length < 6) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'cast') return -1;
  if (tokens[3] !== 'a') return -1;
  if (tokens[4] !== 'spell') return -1;

  let idx = 5;
  if (tokens[idx] === ',') idx++;

  return idx;
}

// ============================================================================
// Phase 17: Additional trigger prefix matchers
// ============================================================================

/**
 * Check if tokens start with "Whenever you gain life ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchLifeGainPrefix(tokens: string[]): number {
  // "whenever you gain life ,"
  if (tokens.length < 5) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'gain') return -1;
  if (tokens[3] !== 'life') return -1;

  let idx = 4;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you draw a card ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchCardDrawnPrefix(tokens: string[]): number {
  // "whenever you draw a card ,"
  if (tokens.length < 6) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'draw') return -1;
  if (tokens[3] !== 'a') return -1;
  if (tokens[4] !== 'card') return -1;

  let idx = 5;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever an opponent casts a spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchOpponentCastSpellPrefix(tokens: string[]): number {
  // "whenever an opponent casts a spell ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'an') return -1;
  if (tokens[2] !== 'opponent') return -1;
  if (tokens[3] !== 'casts') return -1;
  if (tokens[4] !== 'a') return -1;
  if (tokens[5] !== 'spell') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever a creature enters the battlefield ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchAnyCreatureETBPrefix(tokens: string[]): number {
  // "whenever a creature enters the battlefield ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'creature') return -1;
  if (tokens[3] !== 'enters') return -1;
  if (tokens[4] !== 'the') return -1;
  if (tokens[5] !== 'battlefield') return -1;

  let idx = 6;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever you cast an instant or sorcery spell ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchCastInstantOrSorceryPrefix(tokens: string[]): number {
  // "whenever you cast an instant or sorcery spell ,"
  if (tokens.length < 9) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'you') return -1;
  if (tokens[2] !== 'cast') return -1;
  if (tokens[3] !== 'an') return -1;
  if (tokens[4] !== 'instant') return -1;
  if (tokens[5] !== 'or') return -1;
  if (tokens[6] !== 'sorcery') return -1;
  if (tokens[7] !== 'spell') return -1;

  let idx = 8;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "At the beginning of each player's upkeep ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchEachPlayerUpkeepPrefix(tokens: string[]): number {
  // "at the beginning of each player's upkeep ,"
  if (tokens.length < 7) return -1;
  if (tokens[0] !== 'at') return -1;
  if (tokens[1] !== 'the') return -1;
  if (tokens[2] !== 'beginning') return -1;
  if (tokens[3] !== 'of') return -1;
  if (tokens[4] !== 'each') return -1;
  if (tokens[5] !== "player's") return -1;
  if (tokens[6] !== 'upkeep') return -1;

  let idx = 7;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Check if tokens start with "Whenever a land enters the battlefield under your control ,"
 * Returns the index after the trigger prefix, or -1 if no match.
 */
function matchLandfallPrefix(tokens: string[]): number {
  // "whenever a land enters the battlefield under your control ,"
  if (tokens.length < 10) return -1;
  if (tokens[0] !== 'whenever') return -1;
  if (tokens[1] !== 'a') return -1;
  if (tokens[2] !== 'land') return -1;
  if (tokens[3] !== 'enters') return -1;
  if (tokens[4] !== 'the') return -1;
  if (tokens[5] !== 'battlefield') return -1;
  if (tokens[6] !== 'under') return -1;
  if (tokens[7] !== 'your') return -1;
  if (tokens[8] !== 'control') return -1;

  let idx = 9;
  if (tokens[idx] === ',') idx++;

  return idx;
}

/**
 * Try all new trigger prefixes and return [Trigger, effectStartIndex] or null.
 */
function matchTriggerPrefix(tokens: string[]): { trigger: Trigger; effectStart: number } | null {
  let idx: number;

  idx = matchAttacksPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Attacks', who: 'self' }, effectStart: idx };

  idx = matchUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'yours' }, effectStart: idx };

  idx = matchEndStepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'EndStep', whose: 'yours' }, effectStart: idx };

  // Phase 17: Must check AnotherCreatureETB before AnyCreatureETB (more specific first)
  idx = matchAnotherCreatureETBPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'AnotherCreatureETB', controller: 'yours' }, effectStart: idx };

  idx = matchCreatureYouControlDiesPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CreatureYouControlDies' }, effectStart: idx };

  // Phase 17: Must check CastInstantOrSorcery before YouCastSpell (more specific first)
  idx = matchCastInstantOrSorceryPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CastInstantOrSorcery' }, effectStart: idx };

  idx = matchYouCastSpellPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'YouCastSpell' }, effectStart: idx };

  // Phase 17: Additional trigger types
  idx = matchLifeGainPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'LifeGain' }, effectStart: idx };

  idx = matchCardDrawnPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'CardDrawn' }, effectStart: idx };

  idx = matchOpponentCastSpellPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'OpponentCastSpell' }, effectStart: idx };

  idx = matchAnyCreatureETBPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'AnyCreatureETB' }, effectStart: idx };

  idx = matchEachPlayerUpkeepPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Upkeep', whose: 'each' }, effectStart: idx };

  idx = matchLandfallPrefix(tokens);
  if (idx > 0) return { trigger: { kind: 'Landfall' }, effectStart: idx };

  return null;
}

/**
 * Parse multiple effect clauses from tokens, splitting on "then", "and", and ". " boundaries.
 * Returns combined effects and targets, or null if nothing parsed.
 */
function parseMultipleEffects(tokens: string[], startIndex: number): PatternResult {
  const allEffects: Effect[] = [];
  const allTargets: TargetSpec[] = [];

  // Split tokens into clauses by "then", "and", or sentence boundaries
  // We process greedily: try to match at current position, then look for separators
  let pos = startIndex;

  while (pos < tokens.length) {
    // Skip separators: "then", "and", ",", "."
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t === 'then' || t === ',' || t === '.') {
        pos++;
      } else if (t === 'and' && allEffects.length > 0) {
        // Only skip "and" if we already parsed at least one effect
        pos++;
      } else {
        break;
      }
    }

    if (pos >= tokens.length) break;

    const result = parseEffectClause(tokens, pos);
    if (result) {
      allEffects.push(...result.effects);
      allTargets.push(...result.targets);
      pos += result.consumed;
    } else {
      // Can't parse remaining tokens — skip to next separator
      pos++;
    }
  }

  if (allEffects.length === 0) return null;

  return {
    effects: allEffects,
    targets: allTargets,
    consumed: tokens.length - startIndex, // consumed everything we could
  };
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
  let upTo = false;

  if (tokens[1] === 'one' && tokens[2] === 'or' && tokens[3] === 'both') {
    // "choose one or both"
    chooseCount = 2;
    upTo = true;
  } else if (tokens[1] === 'one') {
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
    upTo: upTo || undefined,
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

  // Phase 15: Check for static ability ("Creatures you control get +1/+1", etc.)
  const staticAbility = matchStaticAbility(tokens);
  if (staticAbility) {
    return { kind: 'StaticAbility', ability: staticAbility };
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
    const effectResult = parseMultipleEffects(tokens, etbIndex);
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
    const effectResult = parseMultipleEffects(tokens, diesIndex);
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

  // Check for new trigger types (attacks, upkeep, end step, etc.)
  const triggerMatch = matchTriggerPrefix(tokens);
  if (triggerMatch) {
    const effectResult = parseMultipleEffects(tokens, triggerMatch.effectStart);
    if (effectResult) {
      const ability: TriggeredAbility = {
        kind: 'TriggeredAbility',
        trigger: triggerMatch.trigger,
        effects: effectResult.effects,
      };
      return {
        kind: 'Triggered',
        ability,
        targets: effectResult.targets,
      };
    }
    return { kind: 'Unparsed', reason: 'Could not parse trigger effect clause' };
  }

  // Try to parse as a spell effect (with multi-effect support)
  const effectResult = parseMultipleEffects(tokens, 0);
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

    // Skip loyalty abilities (handled by parseLoyaltyAbilities)
    if (/^[+\-−–]?\d+\s*:/.test(trimmed)) continue;

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

// ============================================================================
// Phase 17: Planeswalker loyalty ability parsing
// ============================================================================

/** Regex to match loyalty ability cost prefix: "+1:", "-3:", "0:", "+2:" */
const LOYALTY_COST_RE = /^([+\-−–]?\d+)\s*:/;

/**
 * Parse planeswalker loyalty abilities from oracle text.
 * Each line starting with "+N:", "-N:", or "0:" is a loyalty ability.
 *
 * Returns an array of LoyaltyAbility AST nodes.
 */
export function parseLoyaltyAbilities(oracleText: string): LoyaltyAbility[] {
  if (!oracleText) return [];

  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  const abilities: LoyaltyAbility[] = [];
  const lines = oracleText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = LOYALTY_COST_RE.exec(trimmed);
    if (!match) continue;

    const loyaltyCost = parseInt(match[1], 10);
    const effectPart = trimmed.slice(match[0].length).trim();

    if (!effectPart) continue;

    // Tokenize and parse the effect portion using existing patterns
    const effectTokens = tokenizeOracleText(effectPart);
    const result = parseMultipleEffects(effectTokens, 0);

    if (!result) continue;

    abilities.push({
      kind: 'LoyaltyAbility',
      loyaltyCost,
      effects: result.effects,
      targets: result.targets.map(t => ({ id: t.id, type: t.type })),
    });
  }

  return abilities;
}
