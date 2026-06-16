// Token-creation matchers extracted from parser.ts (batch 1/12).
// Do NOT edit logic here — keep verbatim with parser.ts originals.

import type { Effect, TokenDefinition, AmountRef, CardFilter, ForEachAmount } from '../ast';
import type { TargetSpec, TargetType } from '../targets';
import type { PatternResult } from '../parser';
import {
  parsePowerToughnessToken,
  predefinedArtifactToken,
  parseCreateTokenWhereXCount,
  parseWordNumber,
  readGrantableKeyword,
  parseEqualToAmount,
  makeTargetSpec,
  makeChosenRef,
  parseSmallNumberToken,
  CREATURE_SUBTYPE_MAP,
  readTargetNounModifiers,
} from '../parser';

function matchCreateToken(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 5) return null;
  if (slice[0] !== 'create' && slice[0] !== 'creates') return null;

  let tokenCount: AmountRef;
  let idx: number;

  // "create a" or "create N"
  if (slice[1] === 'a' || slice[1] === 'an') {
    tokenCount = 1;
    idx = 2;
  } else if (slice[1] === 'x') {
    tokenCount = { kind: 'X' };
    idx = 2;
  } else {
    const n = parseInt(slice[1], 10);
    const wordNumber = parseWordNumber(slice[1]);
    const parsedCount = !isNaN(n) ? n : wordNumber;
    if (isNaN(parsedCount)) return null;
    tokenCount = parsedCount;
    idx = 2;
  }

  // Optional "tapped" / "tapped and attacking" qualifier (token enters tapped;
  // the "attacking" placement is approximated as simply tapped).
  let entersTapped = false;
  if (slice[idx] === 'tapped') {
    entersTapped = true;
    idx++;
    if (slice[idx] === 'and' && slice[idx + 1] === 'attacking') idx += 2;
  }

  const artifactTokenNames = new Set(['blood', 'clue', 'food', 'gold', 'lander', 'map', 'powerstone', 'treasure']);
  const artifactName = slice[idx];
  if (artifactTokenNames.has(artifactName) && (slice[idx + 1] === 'token' || slice[idx + 1] === 'tokens')) {
    idx += 2;
    if (slice[idx] === '.') idx++;

    const token = predefinedArtifactToken(artifactName);

    const effect: Effect = {
      kind: 'CreateToken',
      controller: { kind: 'Controller' },
      token,
      count: tokenCount,
      ...(entersTapped ? { tapped: true } : {}),
    };

    return { effects: [effect], targets: [], consumed: idx };
  }

  // Parse P/T (e.g., "1/1", "2/2", "x/x")
  const ptMatch = slice[idx]?.match(/^(\d+|x)\/(\d+|x)$/);
  if (!ptMatch) return null;
  const parsedPower = parsePowerToughnessToken(ptMatch[1]);
  const parsedToughness = parsePowerToughnessToken(ptMatch[2]);
  if (!parsedPower || !parsedToughness) return null;
  const power = parsedPower.fixed;
  const toughness = parsedToughness.fixed;
  const powerAmount = parsedPower.amount;
  const toughnessAmount = parsedToughness.amount;
  idx++;

  // Parse optional color
  const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];
  const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  };
  while (colorMap[slice[idx]] || (slice[idx] === 'and' && colorMap[slice[idx + 1]])) {
    if (slice[idx] === 'and') idx++;
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

  const keywords: string[] = [];
  if (slice[idx] === 'with') {
    idx++;
    while (slice[idx] && slice[idx] !== ',' && slice[idx] !== '.' && slice[idx] !== 'that') {
      if (slice[idx] === 'and') { idx++; continue; }
      // Prefer canonical multi-word keywords ("first strike", "double strike")
      // so the token's keyword cache stores a single functional keyword rather
      // than two stray words.
      const kw = readGrantableKeyword(slice, idx);
      if (kw) {
        keywords.push(kw.keyword);
        idx += kw.consumed;
      } else {
        keywords.push(slice[idx].charAt(0).toUpperCase() + slice[idx].slice(1));
        idx++;
      }
    }
  }

  // Trailing "that are tapped and attacking" / "that's tapped" qualifier
  // (CR 111.8 placement). Common on plural token wordings (Assemble the Legion,
  // Hordeling Outburst). The "attacking" placement is approximated as tapped,
  // matching the leading-"tapped" handling above.
  if (
    (slice[idx] === 'that' && (slice[idx + 1] === 'are' || slice[idx + 1] === 'is')) ||
    slice[idx] === "that's" || slice[idx] === 'thats'
  ) {
    let look = slice[idx] === 'that' ? idx + 2 : idx + 1;
    if (slice[look] === 'tapped') {
      entersTapped = true;
      idx = look + 1;
      if (slice[idx] === 'and' && slice[idx + 1] === 'attacking') idx += 2;
    }
  }

  if (slice[idx] === ',' && slice[idx + 1] === 'where' && slice[idx + 2] === 'x') {
    if (
      slice[idx + 3] === 'is' &&
      slice[idx + 4] === 'that' &&
      (slice[idx + 5] === "spell's" || slice[idx + 5] === 'spells') &&
      slice[idx + 6] === 'mana' &&
      slice[idx + 7] === 'value'
    ) {
      idx += 8;
    }
  }

  // Handle trailing period
  if (slice[idx] === '.') idx++;
  const dynamicXCount = parseCreateTokenWhereXCount(slice, idx);
  if (dynamicXCount && typeof tokenCount !== 'number' && tokenCount.kind === 'X') {
    tokenCount = dynamicXCount.count;
    idx = dynamicXCount.consumed;
  }

  const token: TokenDefinition = {
    name: subtypes.length > 0 ? subtypes.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') : 'Creature',
    colors,
    types: ['creature'],
    subtypes: subtypes.length > 0 ? subtypes : undefined,
    power,
    toughness,
    ...(powerAmount ? { powerAmount } : {}),
    ...(toughnessAmount ? { toughnessAmount } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };

  if (
    slice[idx] === 'put' &&
    slice[idx + 1] === 'x' &&
    slice[idx + 2] === '+1/+1' &&
    slice[idx + 3] === 'counters' &&
    slice[idx + 4] === 'on' &&
    slice[idx + 5] === 'it'
  ) {
    token.counters = { '+1/+1': { kind: 'EventSpellManaValue' } };
    idx += 6;
    if (
      slice[idx] === ',' &&
      slice[idx + 1] === 'where' &&
      slice[idx + 2] === 'x' &&
      slice[idx + 3] === 'is' &&
      slice[idx + 4] === 'that' &&
      (slice[idx + 5] === "spell's" || slice[idx + 5] === 'spells') &&
      slice[idx + 6] === 'mana' &&
      slice[idx + 7] === 'value'
    ) {
      idx += 8;
    }
    if (slice[idx] === '.') idx++;
  }

  const effect: Effect = {
    kind: 'CreateToken',
    controller: { kind: 'Controller' },
    token,
    count: tokenCount,
    ...(entersTapped ? { tapped: true } : {}),
  };

  return { effects: [effect], targets: [], consumed: idx };
}

/**
 * Match: "that player creates a 1/1 red Goblin creature token"
 *
 * In beginning/end-step triggers, "that player" refers to the active player
 * whose step caused the trigger to fire.
 */
function matchThatPlayerCreatesToken(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'that' || tokens[startIndex + 1] !== 'player') {
    return null;
  }

  const tokenResult = matchCreateToken(tokens, startIndex + 2);
  if (!tokenResult) return null;

  return {
    ...tokenResult,
    effects: tokenResult.effects.map(effect => (
      effect.kind === 'CreateToken'
        ? { ...effect, controller: { kind: 'ActivePlayer' as const } }
        : effect
    )),
    consumed: tokenResult.consumed + 2,
  };
}

/**
 * Match "Create a number of <token> equal to <dynamic>." (dynamic token count).
 */
function matchCreateTokenEqualTo(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  if (slice[0] !== 'create') return null;
  if (!(slice[1] === 'a' && slice[2] === 'number' && slice[3] === 'of')) return null;

  let eqIdx = -1;
  for (let i = 4; i < slice.length - 1; i++) {
    if (slice[i] === 'equal' && slice[i + 1] === 'to') { eqIdx = i; break; }
  }
  if (eqIdx === -1) return null;

  // Rebuild the token-definition clause as "create a <def> ." and reuse matchCreateToken.
  const defSlice = ['create', 'a', ...slice.slice(4, eqIdx), '.'];
  const tokenResult = matchCreateToken(defSlice, 0);
  if (!tokenResult) return null;
  const createEffect = tokenResult.effects[0];
  if (createEffect.kind !== 'CreateToken') return null;

  const dyn = parseEqualToAmount(slice, eqIdx + 2);
  if (!dyn) return null;
  let consumed = dyn.nextIndex;
  if (slice[consumed] === '.') consumed++;

  return { effects: [{ ...createEffect, count: dyn.amount }], targets: [], consumed };
}

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
 * Slice 2 — Saboteur "that many tokens" tail.
 *
 * Matches: "create that many <token-def>"
 *
 * The count resolves to EventDamageAmount (combat damage dealt to a player),
 * the token definition is parsed by delegating to matchCreateToken after
 * substituting "a" for "that many" so the existing token parser does the work.
 *
 * Examples:
 *   "create that many 1/1 green Insect creature tokens."       (Living Hive)
 *   "create that many Treasure tokens."                        (Prosperous Bandit)
 *   "create that many 1/1 colorless Thopter artifact creature tokens." (Sai variant)
 */
export function matchCreateTokenThatMany(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice[0] !== 'create') return null;
  if (slice[1] !== 'that' || slice[2] !== 'many') return null;

  // Re-parse as "create a <rest>" so matchCreateToken handles the definition
  const subSlice = ['create', 'a', ...slice.slice(3)];
  const tokenResult = matchCreateToken(subSlice, 0);
  if (!tokenResult) return null;
  const createEffect = tokenResult.effects[0];
  if (createEffect.kind !== 'CreateToken') return null;

  // consumed: 3 words replaced by "create a" (2), so offset = consumed - 2 + 3 = consumed + 1
  // sub-slice "create a" (2 words) maps to "create that many" (3 words), delta = +1
  let consumed = tokenResult.consumed + 1;
  if (tokens[startIndex + consumed] === '.') consumed++;

  return {
    effects: [{ ...createEffect, count: { kind: 'EventDamageAmount' as const } }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 2 — Saboteur "that player creates that many tokens" tail.
 *
 * Matches: "that player creates that many <token-def>"
 * (Varchild, Betrayer of Kjeldor style — the damaged player gets the tokens.)
 *
 * The token controller is EventPlayer (the player who received the damage);
 * the count is EventDamageAmount.
 *
 * Examples:
 *   "that player creates that many 1/1 red Survivor creature tokens." (Varchild)
 */
export function matchThatPlayerCreatesThatManyTokens(tokens: string[], startIndex: number): PatternResult {
  if (tokens[startIndex] !== 'that' || tokens[startIndex + 1] !== 'player') return null;
  if (tokens[startIndex + 2] !== 'creates') return null;
  if (tokens[startIndex + 3] !== 'that' || tokens[startIndex + 4] !== 'many') return null;

  // Re-parse "create a <rest>" from index 5
  const subSlice = ['create', 'a', ...tokens.slice(startIndex + 5)];
  const tokenResult = matchCreateToken(subSlice, 0);
  if (!tokenResult) return null;
  const createEffect = tokenResult.effects[0];
  if (createEffect.kind !== 'CreateToken') return null;

  // "that player creates that many" = 5 tokens; "create a" = 2 tokens, delta = 3
  const consumed = tokenResult.consumed + 3;

  return {
    effects: [{ ...createEffect, count: { kind: 'EventDamageAmount' as const }, controller: { kind: 'EventPlayer' as const } }],
    targets: [],
    consumed,
  };
}

/**
 * Slice 1 (token-copy): Match "create a/N token(s) that's/that are a/copies of <target>"
 * where the target is a form NOT already handled by matchCopyCreature:
 *   • "another target <type>" — notSource constraint
 *   • "target nonland permanent" — NonlandPermanent TargetType
 *   • "target non-<Subtype> creature" — excludeSubtypes constraint
 *   • "target <type> you control" — controllerControls constraint
 *   • plural fixed-count ("two", "three", …) → N copies emitted as separate effects
 *
 * Declined: "except …" riders, "that many" dynamic counts.
 *
 * Examples:
 *   "create a token that's a copy of another target nonland permanent you control."
 *   "create a token that's a copy of target non-Frog creature."
 *   "create two tokens that are copies of target creature."
 */
export function matchCreateTokenCopy(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);

  if (slice.length < 7) return null;
  if (slice[0] !== 'create' && slice[0] !== 'creates') return null;

  let idx = 1;

  // --- Count: "a/an" (1), word number ("two", "three", …), or digit ---
  let count = 1;
  if (slice[idx] === 'a' || slice[idx] === 'an') {
    count = 1;
    idx++;
  } else {
    const parsed = parseSmallNumberToken(slice[idx] ?? '');
    if (!isNaN(parsed) && parsed >= 2) {
      count = parsed;
      idx++;
    } else {
      return null;
    }
  }

  // --- Token phrase ---
  // Singular: "token that's a copy of" / "token that is a copy of"
  // Plural:   "tokens that are copies of" / "tokens that are a copy of"
  if (slice[idx] !== 'token' && slice[idx] !== 'tokens') return null;
  const isPlural = slice[idx] === 'tokens';
  idx++;

  // Singular copula
  if (!isPlural) {
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
  } else {
    // Plural copula: "that are copies of" / "that are a copy of"
    if (slice[idx] !== 'that') return null;
    idx++;
    if (slice[idx] !== 'are') return null;
    idx++;
    if (slice[idx] === 'a') {
      idx++;
      if (slice[idx] !== 'copy') return null;
      idx++;
    } else if (slice[idx] === 'copies') {
      idx++;
    } else {
      return null;
    }
    if (slice[idx] !== 'of') return null;
    idx++;
  }

  // --- Optional "another" qualifier (notSource) ---
  let notSource = false;
  if (slice[idx] === 'another') {
    notSource = true;
    idx++;
  }

  // --- "target" keyword ---
  if (slice[idx] !== 'target') return null;
  idx++;

  // --- Target type parsing ---
  // Supported forms:
  //   "nonland permanent [you control / an opponent controls]"
  //   "non-<Subtype> creature [you control]" (tokenized as "non", "-", subtype, "creature")
  //   "noncreature permanent [you control]"
  //   + any combination of readTargetNounModifiers modifiers before creature/permanent
  //
  // Declined: "this/~" (handled by matchCopySelfCreature),
  //           plain "creature" w/o any qualifier (handled by matchCopyCreature).

  let targetType: TargetType;
  let constraints: TargetSpec['constraints'] = {};

  // "nonland permanent" → NonlandPermanent
  if (slice[idx] === 'nonland' && (slice[idx + 1] === 'permanent' || slice[idx + 1] === 'permanents')) {
    targetType = 'NonlandPermanent';
    idx += 2;
  }
  // "noncreature permanent" — e.g. Hate Mirage: "noncreature permanent"
  else if (slice[idx] === 'noncreature' && (slice[idx + 1] === 'permanent' || slice[idx + 1] === 'permanents')) {
    targetType = 'Permanent';
    idx += 2;
    constraints.excludeTypes = ['creature'];
  }
  // Handle modifiers before "creature": "non-Frog creature", "non-Dragon creature",
  // "nontoken creature", etc. Use readTargetNounModifiers to parse "non", "-", subtype
  // patterns (which tokenize into 3 tokens: non / - / frog).
  else {
    const mods = readTargetNounModifiers(slice, idx);
    if (mods.consumed > 0) {
      const typeWord = slice[idx + mods.consumed];
      if (typeWord === 'creature' || typeWord === 'creatures') {
        targetType = 'Creature';
        idx += mods.consumed + 1;
        // Merge modifier constraints
        if (mods.constraints.excludeSubtypes) constraints.excludeSubtypes = mods.constraints.excludeSubtypes;
        if (mods.constraints.excludeTypes) constraints.excludeTypes = mods.constraints.excludeTypes;
        if (mods.constraints.excludeSupertypes) constraints.excludeSupertypes = mods.constraints.excludeSupertypes;
        if (mods.constraints.nontoken) constraints.nontoken = mods.constraints.nontoken;
        if (mods.constraints.tappedStatus) constraints.tappedStatus = mods.constraints.tappedStatus;
        if (mods.constraints.combatStatus) constraints.combatStatus = mods.constraints.combatStatus;
        // Slice 3/BC: "target artifact creature" — type-AND constraint
        if (mods.constraints.types) constraints.types = mods.constraints.types;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  // --- Optional "you control" / "an opponent controls" ---
  if (slice[idx] === 'you' && slice[idx + 1] === 'control') {
    constraints.controllerControls = true;
    idx += 2;
  } else if (slice[idx] === 'an' && slice[idx + 1] === 'opponent' && slice[idx + 2] === 'controls') {
    constraints.opponentControls = true;
    idx += 3;
  }

  // --- notSource applies as a constraint ---
  if (notSource) {
    constraints.notSource = true;
  }

  // Clean up empty constraints object
  if (Object.keys(constraints).length === 0) {
    constraints = undefined as unknown as TargetSpec['constraints'];
  }

  // Decline "except" riders (this is the core exclusion)
  if (slice[idx] === ',' && slice[idx + 1] === 'except') return null;
  if (slice[idx] === 'except') return null;

  if (slice[idx] === '.') idx++;

  const spec = makeTargetSpec(targetType, constraints);

  // For count > 1, emit N identical CopyEffect instances so the executor
  // runs executeCopy once per token without needing an AST count field.
  const effects: Effect[] = Array.from({ length: count }, () => ({
    kind: 'Copy' as const,
    target: makeChosenRef(spec),
  }));

  return { effects, targets: [spec], consumed: idx };
}

export { matchCreateToken, matchThatPlayerCreatesToken, matchCreateTokenEqualTo, matchCreateTokenForEach };
