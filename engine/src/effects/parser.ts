// Phase 4: Oracle text parser (v0)
// Converts tokenized oracle text into Effect AST + required TargetSpecs

import { tokenizeOracleText } from './tokens';
import type { Effect, TriggeredAbility, TargetRef, SourceRef } from './ast';
import type { TargetSpec, TargetType } from './targets';

export type ParsedOracle =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[] }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
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
 * Try to parse an effect clause starting at the given index.
 * Returns the first matching pattern.
 */
function parseEffectClause(tokens: string[], startIndex: number): PatternResult {
  // Try patterns in priority order
  const patterns = [
    matchDealDamage,
    matchDestroy,
    matchDraw,
    matchGainLife,
    matchLoseLife,
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
 * Parse oracle text into a ParsedOracle result.
 */
export function parseOracleText(oracleText: string): ParsedOracle {
  // Reset counter for deterministic IDs in tests
  targetSpecCounter = 0;

  const tokens = tokenizeOracleText(oracleText);

  if (tokens.length === 0) {
    return { kind: 'Unparsed', reason: 'Empty oracle text' };
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

  // Try to parse as a spell effect
  const effectResult = parseEffectClause(tokens, 0);
  if (effectResult) {
    return {
      kind: 'Spell',
      effects: effectResult.effects,
      targets: effectResult.targets,
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
